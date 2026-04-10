#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh – Update von Ycontrol Cloud
# Verwendung: ./deploy.sh
# Optional:   ./deploy.sh --skip-pull   (kein git pull, nur rebuild)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

SKIP_PULL=false
for arg in "$@"; do
  [[ "$arg" == "--skip-pull" ]] && SKIP_PULL=true
done

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     Ycontrol Cloud – Update                  ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ─── Voraussetzungen ─────────────────────────────────────────────────────────
[ -f ".env" ] || error ".env fehlt. Bitte zuerst ./install.sh ausführen."

if grep -q "AENDERN_" .env; then
  error "Die .env enthält noch Platzhalter. Bitte zuerst ausfüllen."
fi

# ─── Code aktualisieren ──────────────────────────────────────────────────────
if [ "$SKIP_PULL" = false ]; then
  if [ -d ".git" ]; then
    info "Aktualisiere Code via git (lokale Änderungen werden verworfen)..."
    git fetch origin main
    git reset --hard origin/main
    success "Code aktualisiert"
  else
    warn "Kein Git-Repository gefunden – überspringe git pull"
  fi
fi

if [ -d ".git" ]; then
  COMMIT=$(git log --oneline -1 2>/dev/null || echo "unbekannt")
  info "Aktueller Commit: $COMMIT"
fi

# ─── Images neu bauen ────────────────────────────────────────────────────────
info "Baue Docker Images neu..."
docker compose -f docker-compose.prod.yml build
success "Images gebaut"

# ─── Backend neu starten (führt DB-Migrations aus) ───────────────────────────
info "Starte Backend neu (inkl. DB-Migrations)..."
docker compose -f docker-compose.prod.yml up -d --no-deps backend

info "Warte auf Backend-Start..."
sleep 10

RETRIES=0
MAX_RETRIES=20
until docker compose -f docker-compose.prod.yml ps backend | grep -q "healthy\|running"; do
  sleep 3
  RETRIES=$((RETRIES + 1))
  if [ $RETRIES -ge $MAX_RETRIES ]; then
    warn "Backend nicht in 60s ready – prüfe Logs:"
    docker compose -f docker-compose.prod.yml logs --tail=30 backend
    break
  fi
done
success "Backend läuft"

# ─── Frontend neu starten ────────────────────────────────────────────────────
info "Starte Frontend neu..."
docker compose -f docker-compose.prod.yml up -d --no-deps frontend
success "Frontend neu gestartet"

# ─── cloudflared läuft weiter (kein Neustart nötig) ─────────────────────────
# Das Routing ist in Cloudflare's Dashboard konfiguriert, nicht lokal.
# cloudflared verbindet sich automatisch neu wenn nötig.
info "Cloudflare Tunnel: kein Neustart nötig (Konfiguration liegt bei Cloudflare)"

# ─── EMQX Backend-User sicherstellen (idempotent) ────────────────────────────
info "Konfiguriere EMQX..."
EMQX_PASS=$(grep "^EMQX_DASHBOARD_PASSWORD=" .env | cut -d= -f2 | tr -d '"' || true)
MQTT_USER=$(grep "^MQTT_BACKEND_USER="       .env | cut -d= -f2 | tr -d '"' || true)
MQTT_PASS=$(grep "^MQTT_BACKEND_PASSWORD="   .env | cut -d= -f2 | tr -d '"' || true)

# Auf EMQX warten – /api/v5/status braucht KEINE Auth, daher nur auf HTTP 200 prüfen
EMQX_READY=0
for i in $(seq 1 6); do
  EMQX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:18083/api/v5/status" 2>/dev/null || echo "0")
  if [ "$EMQX_STATUS" = "200" ]; then
    EMQX_READY=1; break
  fi
  info "EMQX noch nicht bereit (HTTP ${EMQX_STATUS}) – warte 5s..."
  sleep 5
done

if [ "$EMQX_READY" = "1" ]; then

  # Hilfsfunktion: MQTT-User anlegen/aktualisieren
  emqx_setup_mqtt_user() {
    local pass="$1"
    # HTTP-Webhook-Auth entfernen falls vorhanden
    AUTH_LIST=$(curl -s -u "admin:${pass}" \
      "http://localhost:18083/api/v5/authentication" 2>/dev/null || echo "[]")
    if echo "$AUTH_LIST" | grep -q "authn-http"; then
      info "Entferne HTTP-Webhook-Authentifikator..."
      curl -s -X DELETE -u "admin:${pass}" \
        "http://localhost:18083/api/v5/authentication/authn-http%3Apost" >/dev/null 2>&1 || true
      success "HTTP-Webhook-Authentifikator entfernt"
    fi
    # MQTT-Backend-User anlegen oder aktualisieren
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST -u "admin:${pass}" \
      "http://localhost:18083/api/v5/authentication/password_based%3Abuilt_in_database/users" \
      -H "Content-Type: application/json" \
      -d "{\"user_id\":\"${MQTT_USER}\",\"password\":\"${MQTT_PASS}\",\"is_superuser\":true}" \
      2>/dev/null || echo "0")
    if [ "$HTTP_CODE" = "201" ]; then
      success "MQTT Backend-User '${MQTT_USER}' angelegt"; return 0
    elif [ "$HTTP_CODE" = "409" ]; then
      curl -s -X PUT -u "admin:${pass}" \
        "http://localhost:18083/api/v5/authentication/password_based%3Abuilt_in_database/users/${MQTT_USER}" \
        -H "Content-Type: application/json" \
        -d "{\"password\":\"${MQTT_PASS}\",\"is_superuser\":true}" >/dev/null 2>&1 || true
      success "MQTT Backend-User '${MQTT_USER}' Passwort aktualisiert"; return 0
    fi
    return 1
  }

  # Versuch 1: mit konfiguriertem Passwort
  API_CHECK=$(curl -s -o /dev/null -w "%{http_code}" -u "admin:${EMQX_PASS}" \
    "http://localhost:18083/api/v5/authentication" 2>/dev/null || echo "0")

  if [ "$API_CHECK" != "401" ]; then
    emqx_setup_mqtt_user "${EMQX_PASS}"
  else
    # Versuch 2: emqx ctl admins passwd + neu probieren
    info "API noch 401 – setze Passwort via emqx ctl..."
    docker compose -f docker-compose.prod.yml exec -T emqx \
      emqx ctl admins passwd admin "${EMQX_PASS}" >/dev/null 2>&1 || true
    sleep 5
    API_CHECK2=$(curl -s -o /dev/null -w "%{http_code}" -u "admin:${EMQX_PASS}" \
      "http://localhost:18083/api/v5/authentication" 2>/dev/null || echo "0")

    if [ "$API_CHECK2" != "401" ]; then
      success "EMQX Passwort über emqx ctl gesetzt"
      emqx_setup_mqtt_user "${EMQX_PASS}"
    else
      # Versuch 3: emqx_data Volume hart zurücksetzen
      warn "EMQX API weiterhin 401 – setze emqx_data Volume zurück..."
      docker compose -f docker-compose.prod.yml stop emqx >/dev/null 2>&1 || true
      docker compose -f docker-compose.prod.yml rm -f emqx >/dev/null 2>&1 || true

      # Volume direkt über bekannte Namen löschen (compose-Projektname = Verzeichnisname)
      COMPOSE_PROJECT=$(basename "$(pwd)")
      for vol in "${COMPOSE_PROJECT}_emqx_data" "ycontrol_emqx_data" "emqx_data"; do
        if docker volume inspect "$vol" >/dev/null 2>&1; then
          docker volume rm "$vol" >/dev/null 2>&1 \
            && success "Volume '${vol}' gelöscht" \
            || warn "Volume '${vol}' konnte nicht gelöscht werden (noch in Benutzung?)"
          break
        fi
      done

      docker compose -f docker-compose.prod.yml up -d emqx >/dev/null 2>&1

      # Warten bis EMQX API antwortet (max 60s)
      info "Warte auf EMQX nach Volume-Reset..."
      for i in $(seq 1 12); do
        ST=$(curl -s -o /dev/null -w "%{http_code}" \
          -u "admin:${EMQX_PASS}" \
          "http://localhost:18083/api/v5/authentication" 2>/dev/null || echo "0")
        if echo "$ST" | grep -qE '^2[0-9][0-9]$'; then
          success "EMQX bereit (HTTP ${ST})"
          emqx_setup_mqtt_user "${EMQX_PASS}" \
            || warn "MQTT Backend-User konnte nicht angelegt werden (HTTP ${ST})"
          break
        fi
        info "EMQX noch nicht bereit (HTTP ${ST}) – warte 5s... ($i/12)"
        sleep 5
      done
    fi
  fi

else
  warn "EMQX nicht erreichbar nach 30s – MQTT-Auth übersprungen"
  warn "  Prüfe: docker compose -f docker-compose.prod.yml logs emqx"
fi

# ─── Alte Images aufräumen ───────────────────────────────────────────────────
info "Räume alte Images auf..."
docker image prune -f --filter "dangling=true" >/dev/null 2>&1 || true
success "Aufgeräumt"

# ─── Fertig ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Update erfolgreich abgeschlossen!                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

APP_URL=$(grep -E "^APP_URL=" .env | cut -d= -f2 | tr -d '"')
echo -e "  🌐 App:    ${CYAN}${APP_URL}${NC}"
echo ""
echo -e "  Logs:   ${CYAN}docker compose -f docker-compose.prod.yml logs -f${NC}"
echo ""

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
    info "Aktualisiere Code via git pull..."
    git pull origin main
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
info "Prüfe EMQX Backend-User..."
EMQX_PASS=$(grep "^EMQX_DASHBOARD_PASSWORD=" .env | cut -d= -f2 | tr -d '"')
MQTT_USER=$(grep "^MQTT_BACKEND_USER=" .env | cut -d= -f2 | tr -d '"')
MQTT_PASS=$(grep "^MQTT_BACKEND_PASSWORD=" .env | cut -d= -f2 | tr -d '"')

if curl -sf -u "admin:${EMQX_PASS}" "http://localhost:18083/api/v5/status" &>/dev/null; then
  # HTTP-Webhook-Auth entfernen falls vorhanden
  HTTP_AUTH=$(curl -sf -u "admin:${EMQX_PASS}" \
    "http://localhost:18083/api/v5/authentication" | grep -c "authn-http" || true)
  if [ "${HTTP_AUTH}" -gt 0 ]; then
    curl -sf -X DELETE -u "admin:${EMQX_PASS}" \
      "http://localhost:18083/api/v5/authentication/authn-http%3Apost" >/dev/null || true
    info "HTTP-Webhook-Authentifikator entfernt"
  fi

  # User anlegen oder Passwort aktualisieren
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST -u "admin:${EMQX_PASS}" \
    "http://localhost:18083/api/v5/authentication/password_based%3Abuilt_in_database/users" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\":\"${MQTT_USER}\",\"password\":\"${MQTT_PASS}\",\"is_superuser\":true}")
  if [ "$HTTP_CODE" = "201" ]; then
    success "MQTT Backend-User angelegt"
  elif [ "$HTTP_CODE" = "409" ]; then
    curl -sf -X PUT -u "admin:${EMQX_PASS}" \
      "http://localhost:18083/api/v5/authentication/password_based%3Abuilt_in_database/users/${MQTT_USER}" \
      -H "Content-Type: application/json" \
      -d "{\"password\":\"${MQTT_PASS}\",\"is_superuser\":true}" >/dev/null
    success "MQTT Backend-User Passwort aktualisiert"
  fi
else
  warn "EMQX nicht erreichbar – MQTT-Auth übersprungen"
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

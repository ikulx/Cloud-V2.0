#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh – Update von Ycontrol Cloud
# Verwendung: ./deploy.sh
# Optional:   ./deploy.sh --skip-pull   (kein git pull, nur rebuild)
#             ./deploy.sh --no-cache    (Full-Rebuild ohne Layer-Cache, langsam)
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
NO_CACHE=false
for arg in "$@"; do
  [[ "$arg" == "--skip-pull" ]] && SKIP_PULL=true
  [[ "$arg" == "--no-cache" ]] && NO_CACHE=true
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

# ─── Disk-Check vor dem Build (Build braucht ~5GB frei) ─────────────────────
FREE_GB=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')
if [ "${FREE_GB:-0}" -lt 5 ]; then
  warn "Nur ${FREE_GB}GB frei – räume Build-Cache auf..."
  docker buildx prune -af --filter "until=24h" >/dev/null 2>&1 || true
  docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true
  FREE_GB=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')
  info "Jetzt ${FREE_GB}GB frei"
fi

# ─── Images neu bauen ────────────────────────────────────────────────────────
if [ "$NO_CACHE" = true ]; then
  info "Baue Docker Images neu (--no-cache)..."
  docker compose -f docker-compose.prod.yml build --no-cache
else
  # Standard: mit Layer-Cache. Nur bei wirklich nötigen Full-Rebuilds
  # ./deploy.sh --no-cache aufrufen.
  info "Baue Docker Images neu (mit Layer-Cache)..."
  docker compose -f docker-compose.prod.yml build
fi
success "Images gebaut"

# ─── MQTT neu starten (Mosquitto – Config aus Git-Repo) ──────────────────────
info "Starte Mosquitto MQTT neu (falls Config geändert)..."
docker compose -f docker-compose.prod.yml up -d --no-deps mqtt
success "Mosquitto aktuell"

# ─── WireGuard VPN-Server ─────────────────────────────────────────────────────
info "Starte WireGuard VPN-Server..."
docker compose -f docker-compose.prod.yml up -d --no-deps wireguard
success "WireGuard gestartet"

# ─── Backend neu starten (führt DB-Migrations aus) ───────────────────────────
info "Starte Backend neu (inkl. DB-Migrations)..."
docker compose -f docker-compose.prod.yml up -d --no-deps backend

info "Warte auf Backend-Start..."
RETRIES=0
MAX_RETRIES=30
until docker compose -f docker-compose.prod.yml exec -T backend wget -qO- http://localhost:3000/health >/dev/null 2>&1; do
  sleep 2
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

# ─── Alte Images + Build-Cache aufräumen ─────────────────────────────────────
info "Räume alte Images + Build-Cache auf..."
docker image prune -f --filter "dangling=true" >/dev/null 2>&1 || true
# Build-Cache der älter als 7 Tage ist weg – hält den Cache unter Kontrolle
# ohne bei jedem Deploy den ganzen Cache zu verlieren.
docker buildx prune -af --filter "until=168h" >/dev/null 2>&1 || true
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

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh – Erstinstallation von Ycontrol Cloud auf einem VPS
# Verwendung: chmod +x install.sh && ./install.sh
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

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     Ycontrol Cloud – Erstinstallation        ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ─── Voraussetzungen prüfen ───────────────────────────────────────────────────
info "Prüfe Voraussetzungen..."

if ! command -v docker &>/dev/null; then
  error "Docker ist nicht installiert. Bitte zuerst Docker installieren:
  curl -fsSL https://get.docker.com | sh"
fi

DOCKER_VERSION=$(docker --version | grep -oP '\d+\.\d+' | head -1)
info "Docker Version: $DOCKER_VERSION"

if ! docker compose version &>/dev/null; then
  error "Docker Compose (Plugin) nicht gefunden. Bitte 'docker-compose-plugin' installieren."
fi

success "Docker & Docker Compose verfügbar"

# ─── .env prüfen ─────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  if [ -f ".env.production.example" ]; then
    warn ".env fehlt – erstelle aus .env.production.example"
    cp .env.production.example .env
    echo ""
    echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  AKTION ERFORDERLICH: .env anpassen!                         ║${NC}"
    echo -e "${YELLOW}║                                                              ║${NC}"
    echo -e "${YELLOW}║  1. Öffne die Datei:  nano .env                              ║${NC}"
    echo -e "${YELLOW}║  2. Ersetze ALLE 'AENDERN_...' Werte                         ║${NC}"
    echo -e "${YELLOW}║  3. CLOUDFLARE_TUNNEL_TOKEN aus dem CF-Dashboard eintragen   ║${NC}"
    echo -e "${YELLOW}║  4. Führe danach './install.sh' erneut aus                   ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 0
  else
    error ".env und .env.production.example fehlen beide. Bitte .env manuell erstellen."
  fi
fi

# Prüfe ob noch Platzhalter in .env vorhanden
if grep -q "AENDERN_" .env; then
  echo ""
  error "Die .env enthält noch Platzhalter (AENDERN_...). Bitte alle Werte ausfüllen, dann erneut ausführen."
fi

# Prüfe Cloudflare Token
CF_TOKEN=$(grep -E "^CLOUDFLARE_TUNNEL_TOKEN=" .env | cut -d= -f2 | tr -d '"')
if [ -z "$CF_TOKEN" ]; then
  error "CLOUDFLARE_TUNNEL_TOKEN ist leer. Bitte im Cloudflare Zero Trust Dashboard einen Tunnel erstellen und das Token eintragen."
fi

success ".env gefunden und vollständig"

# ─── EMQX Konfigurationsverzeichnis erstellen ─────────────────────────────────
if [ ! -d "emqx" ]; then
  info "Erstelle emqx/ Konfigurationsverzeichnis..."
  mkdir -p emqx
fi

if [ ! -f "emqx/emqx.conf" ]; then
  info "Erstelle Standard emqx.conf..."
  cat > emqx/emqx.conf << 'EMQXCONF'
listeners.tcp.default {
  bind = "0.0.0.0:1883"
}

listeners.ws.default {
  bind = "0.0.0.0:8083"
}

dashboard {
  listeners.http.bind = 18083
}

authentication = [
  {
    mechanism = password_based
    backend   = built_in_database
    enable    = true
  }
]
EMQXCONF
  success "emqx.conf erstellt"
fi

if [ ! -f "emqx/acl.conf" ]; then
  info "Erstelle Standard acl.conf..."
  cat > emqx/acl.conf << 'ACLCONF'
{allow, all, subscribe, ["$SYS/#"]}.
{allow, all, pubsub, ["ycontrol/#"]}.
{deny, all}.
ACLCONF
  success "acl.conf erstellt"
fi

# ─── Images bauen ────────────────────────────────────────────────────────────
info "Baue Docker Images (das dauert beim ersten Mal ca. 3-5 Minuten)..."
docker compose -f docker-compose.prod.yml build --no-cache
success "Images gebaut"

# ─── Datenbank zuerst starten ────────────────────────────────────────────────
info "Starte PostgreSQL..."
docker compose -f docker-compose.prod.yml up -d postgres
info "Warte auf Datenbankbereitschaft..."
sleep 5

# ─── Alle Services starten ───────────────────────────────────────────────────
info "Starte alle Services..."
docker compose -f docker-compose.prod.yml up -d
success "Alle Services gestartet"

# ─── Warten bis Backend bereit ist ───────────────────────────────────────────
info "Warte auf Backend (Migrations + Seed)..."
MAX_WAIT=120
WAITED=0
until docker compose -f docker-compose.prod.yml exec -T backend node -e "process.exit(0)" &>/dev/null; do
  sleep 3
  WAITED=$((WAITED + 3))
  if [ $WAITED -ge $MAX_WAIT ]; then
    warn "Backend-Timeout – prüfe Logs mit: docker compose -f docker-compose.prod.yml logs backend"
    break
  fi
done

sleep 5  # Extra Zeit für Migrations

# ─── Seed ausführen ──────────────────────────────────────────────────────────
info "Führe Datenbank-Seed aus..."
if docker compose -f docker-compose.prod.yml exec -T backend \
    node -e "require('./dist/prisma/seed.js').main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })" 2>/dev/null; then
  success "Seed ausgeführt"
else
  warn "Seed via dist nicht möglich – bitte manuell ausführen:"
  warn "  docker compose -f docker-compose.prod.yml exec backend npx prisma db seed"
fi

# ─── Cloudflare Tunnel Status prüfen ─────────────────────────────────────────
info "Prüfe Cloudflare Tunnel..."
sleep 3
if docker compose -f docker-compose.prod.yml ps cloudflared | grep -q "running\|Up"; then
  success "Cloudflare Tunnel läuft"
else
  warn "Cloudflare Tunnel Status unklar – prüfe Logs:"
  warn "  docker compose -f docker-compose.prod.yml logs cloudflared"
fi

# ─── Status anzeigen ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Installation abgeschlossen!                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

APP_URL=$(grep -E "^APP_URL=" .env | cut -d= -f2 | tr -d '"')
echo -e "  🌐 App:      ${CYAN}${APP_URL}${NC}"
echo -e "  🔒 Tunnel:   Cloudflare Zero Trust Dashboard"
echo -e "  📡 MQTT:     Port 1883 (direkt, für Raspberry Pi)"
echo ""
echo -e "  Standard-Login:"
echo -e "    E-Mail:    ${YELLOW}admin@example.com${NC}"
echo -e "    Passwort:  ${YELLOW}Admin1234!${NC}  ← bitte sofort ändern!"
echo ""
echo -e "  Nützliche Befehle:"
echo -e "    Logs:     ${CYAN}docker compose -f docker-compose.prod.yml logs -f${NC}"
echo -e "    Status:   ${CYAN}docker compose -f docker-compose.prod.yml ps${NC}"
echo -e "    Update:   ${CYAN}./deploy.sh${NC}"
echo ""

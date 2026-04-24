# Ycontrol Cloud – Deployment Anleitung

> **Zugang von außen:** Cloudflare Tunnel (`cloudflared`)
> Kein offener Port 80/443 nötig. HTTPS und Zertifikate übernimmt Cloudflare automatisch.
> Offene Ports: **1883** (MQTT für Raspberry Pi) und **51820/UDP** (WireGuard VPN).

---

## Inhaltsverzeichnis

1. [Architektur-Übersicht](#1-architektur-übersicht)
2. [VPS vorbereiten](#2-vps-vorbereiten)
3. [Docker installieren](#3-docker-installieren)
4. [Firewall konfigurieren](#4-firewall-konfigurieren)
5. [Cloudflare vorbereiten](#5-cloudflare-vorbereiten)
6. [Cloudflare Tunnel erstellen](#6-cloudflare-tunnel-erstellen)
7. [Code auf den Server bringen](#7-code-auf-den-server-bringen)
8. [Umgebungsvariablen konfigurieren](#8-umgebungsvariablen-konfigurieren)
9. [WireGuard VPN einrichten](#9-wireguard-vpn-einrichten)
10. [Erstinstallation starten](#10-erstinstallation-starten)
11. [Testen ob alles läuft](#11-testen-ob-alles-läuft)
12. [Update einspielen](#12-update-einspielen)
13. [Raspberry Pi registrieren](#13-raspberry-pi-registrieren)
14. [Nützliche Befehle im Alltag](#14-nützliche-befehle-im-alltag)
15. [Backup-Konzept & automatisches Backup](#15-backup-konzept--automatisches-backup)
16. [Server wiederherstellen (Disaster Recovery)](#16-server-wiederherstellen-disaster-recovery)
17. [Fehlerbehebung](#17-fehlerbehebung)

---

## 1. Architektur-Übersicht

```
Internet
   │
   ▼
┌─────────────────────────────┐
│      Cloudflare Edge        │  ← HTTPS, DDoS-Schutz, WAF (kostenlos)
│  cloud.deine-domain.de:443  │
└────────────┬────────────────┘
             │ verschlüsselter Tunnel (ausgehend vom VPS)
             ▼
┌─────────────────────────────────────────────────────────────┐
│  VPS                                                        │
│                                                             │
│  ┌─────────────┐    ┌──────────────┐                       │
│  │ cloudflared │───▶│  frontend:80 │ (nginx)               │
│  │  (Tunnel)   │    │  /api/* ────▶│  backend:3000         │
│  └─────────────┘    └──────────────┘                       │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────┐  │
│  │  backend     │   │  postgres    │   │  mosquitto    │  │
│  │  :3000       │───│  :5432       │   │  :1883 (MQTT) │  │
│  └──────────────┘   └──────────────┘   └───────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  wireguard  :51820/UDP  (VPN für Anlagen + Techniker) │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  Port 1883/TCP  offen ──▶ MQTT (Raspberry Pi Telemetrie)   │
│  Port 51820/UDP offen ──▶ WireGuard VPN                    │
└─────────────────────────────────────────────────────────────┘
```

**Vorteile des Cloudflare Tunnels:**
- Keine offenen Ports 80/443 → kein direkter Angriffspunkt
- HTTPS-Zertifikat automatisch, ohne Let's Encrypt auf dem Server
- DDoS-Schutz und WAF von Cloudflare kostenlos inklusive
- Funktioniert auch hinter NAT / ohne feste IP

---

## 2. VPS vorbereiten

### Empfohlene Mindestanforderungen

| Eigenschaft | Minimum | Empfohlen |
|-------------|---------|-----------|
| Betriebssystem | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| RAM | 2 GB | 4 GB |
| CPU | 1 vCore | 2 vCores |
| Disk | 20 GB SSD | 40 GB SSD |

### Per SSH einloggen

```bash
ssh root@DEINE-VPS-IP
```

### System aktualisieren

```bash
sudo apt update && sudo apt upgrade -y
```

> **Tipp:** Eigenen Benutzer anlegen statt als `root` zu arbeiten:
> ```bash
> adduser ycontrol
> usermod -aG sudo ycontrol
> su - ycontrol
> ```

---

## 3. Docker installieren

```bash
# Offizielles Docker-Installationsskript
curl -fsSL https://get.docker.com | sh

# Aktuellen Benutzer zur Docker-Gruppe hinzufügen
sudo usermod -aG docker $USER

# Gruppe sofort aktivieren (oder aus- und einloggen)
newgrp docker

# Prüfen
docker --version
docker compose version
```

**Erwartete Ausgabe:**
```
Docker version 26.x.x, build ...
Docker Compose version v2.x.x
```

---

## 4. Firewall konfigurieren

Da der Web-Traffic über den Cloudflare Tunnel läuft, müssen Port 80 und 443
**nicht** geöffnet werden.

```bash
# SSH immer offen lassen!
sudo ufw allow 22/tcp

# MQTT für Raspberry Pi Geräte
sudo ufw allow 1883/tcp

# WireGuard VPN (für Anlagen-Fernzugriff und Techniker)
sudo ufw allow 51820/udp

# Firewall aktivieren
sudo ufw enable

# Status prüfen
sudo ufw status
```

Erwartete Ausgabe:
```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
1883/tcp                   ALLOW       Anywhere
51820/udp                  ALLOW       Anywhere
```

---

## 5. Cloudflare vorbereiten

### Voraussetzungen
- Ein **kostenloses Cloudflare-Konto** unter [cloudflare.com](https://cloudflare.com)
- Deine Domain muss bei Cloudflare verwaltet werden (Nameserver auf Cloudflare zeigen)

### Domain zu Cloudflare hinzufügen (falls noch nicht gemacht)

1. Im Cloudflare-Dashboard auf **„Add a Site"** klicken
2. Domain eingeben (z.B. `deine-domain.de`) → **„Free"** Plan wählen
3. Cloudflare zeigt zwei Nameserver an, z.B.:
   ```
   aria.ns.cloudflare.com
   bob.ns.cloudflare.com
   ```
4. Diese Nameserver beim Domain-Registrar eintragen (IONOS, Namecheap, etc.)
5. Warten bis Cloudflare die Domain als **„Active"** markiert (kann 24h dauern, meist < 1h)

> Wenn deine Domain bereits bei Cloudflare ist, diesen Schritt überspringen.

---

## 6. Cloudflare Tunnel erstellen

### Schritt 1: Zero Trust Dashboard öffnen

1. Auf [one.dash.cloudflare.com](https://one.dash.cloudflare.com) einloggen
2. Links im Menü: **Networks → Tunnels**
3. Auf **„+ Create a tunnel"** klicken

### Schritt 2: Tunnel-Typ wählen

- **„Cloudflared"** auswählen → **„Next"**

### Schritt 3: Tunnel benennen

- Name eintragen, z.B. `ycontrol-production` → **„Save tunnel"**

### Schritt 4: Token kopieren

Cloudflare zeigt jetzt einen Installations-Befehl, z.B.:
```bash
cloudflared service install eyJhIjoiYTR...sehr-langer-token...
```

Den langen Token-String (alles nach `service install `) kopieren und aufbewahren.
Er wird später in die `.env`-Datei eingetragen als `CLOUDFLARE_TUNNEL_TOKEN`.

> **Wichtig:** Den Token wie ein Passwort behandeln.

### Schritt 5: Public Hostname konfigurieren

Im nächsten Schritt „Route tunnel" → Tab **„Public Hostname"**:

| Feld | Wert |
|------|------|
| Subdomain | `cloud` |
| Domain | `deine-domain.de` |
| Type | `HTTP` |
| URL | `frontend:80` |

→ **„Save tunnel"** klicken

> **Warum `frontend:80` und nicht `localhost:80`?**
> `cloudflared` läuft im selben Docker-Netzwerk wie die anderen Container.
> `frontend` ist der interne Docker-Containername, der direkt auflösbar ist.

---

## 7. Code auf den Server bringen

```bash
# Code nach /opt/ycontrol klonen
sudo git clone https://github.com/DEIN-BENUTZERNAME/ycontrol-cloud.git /opt/ycontrol

# Besitzer setzen
sudo chown -R $USER:$USER /opt/ycontrol

# In Projektverzeichnis wechseln
cd /opt/ycontrol

# Skripte ausführbar machen
chmod +x install.sh deploy.sh
```

---

## 8. Umgebungsvariablen konfigurieren

### Schritt 1: Vorlage kopieren

```bash
cd /opt/ycontrol
cp .env.production.example .env
```

### Schritt 2: Sichere Passwörter generieren

```bash
echo "DB_PASSWORD:           $(openssl rand -hex 32)"
echo "JWT_ACCESS_SECRET:     $(openssl rand -hex 64)"
echo "JWT_REFRESH_SECRET:    $(openssl rand -hex 64)"
echo "MQTT_AUTH_SECRET:      $(openssl rand -hex 32)"
echo "MQTT_BACKEND_PASSWORD: $(openssl rand -hex 32)"
```

### Schritt 3: .env bearbeiten

```bash
nano .env
```

Alle Felder ausfüllen:

```env
# Cloudflare Tunnel Token (aus Schritt 6)
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYTR...der-lange-token-aus-cloudflare...

# App URL
APP_URL=https://cloud.deine-domain.de

# Datenbank
DB_USER=postgres
DB_PASSWORD=<aus openssl rand -hex 32>
DB_NAME=ycontrol_cloud

# JWT
JWT_ACCESS_SECRET=<aus openssl rand -hex 64>
JWT_REFRESH_SECRET=<aus openssl rand -hex 64>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# MQTT
MQTT_AUTH_SECRET=<aus openssl rand -hex 32>
MQTT_BACKEND_USER=backend-client
MQTT_BACKEND_PASSWORD=<aus openssl rand -hex 32>

# WireGuard VPN (kann nach Schritt 9 ausgefüllt werden)
VPN_SERVER_PRIVATE_KEY=<aus wg genkey>
```

Speichern: `Strg + O` → `Enter` → `Strg + X`

### Schritt 4: Prüfen ob alle Werte gesetzt sind

```bash
grep "AENDERN_" .env
# Erwartete Ausgabe: leer (keine Treffer)
```

---

## 9. WireGuard VPN einrichten

Das WireGuard VPN ermöglicht Technikern sicheren Fernzugriff auf Anlagen-Netzwerke.
Der VPN-Server läuft als Docker-Container direkt auf dem VPS.

### Schritt 1: Server-Schlüsselpaar generieren

WireGuard muss auf dem VPS **nicht** installiert sein – die Tools laufen im Container.
Das Schlüsselpaar einmalig generieren:

```bash
# WireGuard-Tools temporär nutzen (via Docker)
docker run --rm alpine sh -c "apk add -q wireguard-tools && \
  priv=\$(wg genkey) && \
  echo \"Private: \$priv\" && \
  echo \"Public:  \$(echo \$priv | wg pubkey)\""
```

Ausgabe:
```
Private: <privater Schlüssel>   ← in .env als VPN_SERVER_PRIVATE_KEY eintragen
Public:  <öffentlicher Schlüssel>  ← im Cloud-UI unter VPN → Einstellungen eintragen
```

### Schritt 2: Privaten Schlüssel in .env eintragen

```bash
nano /opt/ycontrol/.env
# VPN_SERVER_PRIVATE_KEY=<privater Schlüssel aus Schritt 1>
```

### Schritt 3: Nach der Installation – VPN im UI konfigurieren

Nach dem Starten der App unter **VPN → Server-Einstellungen**:

| Feld | Wert |
|------|------|
| Öffentlicher Schlüssel | Ausgabe aus Schritt 1 (zweite Zeile) |
| Server-Endpunkt | `DEINE-VPS-IP:51820` oder `vpn.deine-domain.de:51820` |
| Port | `51820` |

→ **Speichern** → `wg0.conf` wird automatisch vom Backend geschrieben und der WireGuard-Container neu geladen.

### IP-Adressraum

```
Zone A — Management (10.0.0.0/16)
  10.0.x.y     Techniker-PCs (VPN-Peers)
  10.1.0.1     Cloud-Server (wg0 Interface)

Zone B — Anlagen (10.11.0.0/8)
  10.11.1.0/24 → Anlage 1  (NETMAP ↔ reales LAN, z.B. 192.168.10.0/24)
  10.11.2.0/24 → Anlage 2
  ...
  max. 62 720 Anlagen
```

---

## 10. Erstinstallation starten

```bash
cd /opt/ycontrol
./install.sh
```

**Was das Skript macht:**

```
[INFO]  Prüfe Voraussetzungen...
[OK]    Docker & Docker Compose verfügbar
[OK]    .env gefunden und vollständig
[OK]    Mosquitto-Konfiguration vorhanden
[INFO]  Baue Docker Images (ca. 3-5 Minuten beim ersten Mal)...
[OK]    Images gebaut
[INFO]  Starte PostgreSQL...
[INFO]  Starte alle Services...
[OK]    Alle Services gestartet
[INFO]  Warte auf Backend (Migrations + Seed)...
[OK]    Backend bereit
[OK]    Cloudflare Tunnel läuft
[OK]    Mosquitto MQTT Broker läuft

╔══════════════════════════════════════════════════════════════╗
║          Installation abgeschlossen!                         ║
╚══════════════════════════════════════════════════════════════╝

  🌐 App:      https://cloud.deine-domain.de
  Standard-Login:
    E-Mail:    admin@ycontrol.local
    Passwort:  Admin1234!  ← bitte sofort ändern!
```

**Gestartete Container:**

| Container | Beschreibung |
|-----------|-------------|
| `ycontrol_postgres` | PostgreSQL Datenbank |
| `ycontrol_mqtt` | Mosquitto MQTT-Broker (Port 1883) |
| `ycontrol_wireguard` | WireGuard VPN-Server (Port 51820/UDP) |
| `ycontrol_backend` | Node.js API (intern Port 3000) |
| `ycontrol_frontend` | React + Nginx (intern Port 80) |
| `ycontrol_cloudflared` | Cloudflare Tunnel |

---

## 11. Testen ob alles läuft

### Container-Status prüfen

```bash
docker compose -f docker-compose.prod.yml ps
```

Alle Container müssen `running` oder `healthy` sein:

```
NAME                    STATUS
ycontrol_postgres       running (healthy)
ycontrol_mqtt           running (healthy)
ycontrol_wireguard      running
ycontrol_backend        running (healthy)
ycontrol_frontend       running
ycontrol_cloudflared    running
```

### Tunnel-Status prüfen

```bash
docker compose -f docker-compose.prod.yml logs cloudflared | tail -20
```

In den Logs sollte stehen:
```
... Registered tunnel connection connIndex=0 ...
```

### Im Browser öffnen

```
https://cloud.deine-domain.de
```

→ Login-Seite erscheint mit Cloudflare-HTTPS-Schloss ✓

### Health-Check aufrufen

```bash
curl https://cloud.deine-domain.de/health
# {"status":"ok"}
```

### Einloggen und Passwort ändern

1. E-Mail: `admin@ycontrol.local`
2. Passwort: `Admin1234!`
3. Sofort zu **Profil / Einstellungen** navigieren und Passwort ändern

---

## 12. Update einspielen

### Auf dem lokalen Entwicklungsrechner

```bash
git add .
git commit -m "Beschreibung der Änderungen"
git push origin main
```

### Auf dem VPS

```bash
cd /opt/ycontrol
./deploy.sh
```

**Was `deploy.sh` macht:**

| Schritt | Aktion |
|---------|--------|
| 1 | `git fetch + reset --hard` – neuesten Code holen (lokale Änderungen werden überschrieben) |
| 2 | Mosquitto neu starten (falls Konfig geändert) |
| 3 | Docker Images neu bauen (mit Cache) |
| 4 | Backend neu starten → `prisma db push` + Seed läuft automatisch |
| 5 | Frontend neu starten |
| 6 | cloudflared läuft weiter (kein Neustart nötig) |
| 7 | Alte Images aufräumen |

> **Downtime:** Backend ca. 5–15 Sekunden. Frontend ca. 0 Sekunden.

### Update ohne git pull

```bash
./deploy.sh --skip-pull
```

### Nur ein einzelnes Service neu starten

```bash
# Nur Backend (z.B. nach .env-Änderung)
docker compose -f docker-compose.prod.yml up -d --no-deps backend

# Nur Frontend
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d --no-deps frontend

# WireGuard-Konfig manuell neu laden
docker kill --signal SIGHUP ycontrol_wireguard
```

---

## 13. Raspberry Pi registrieren

### Setup-Script herunterladen

Im Cloud-UI unter **Geräte → Setup-Script herunterladen** (erfordert `devices:read` Berechtigung).
Das Script auf den Pi kopieren und ausführen:

```bash
sudo python3 ycontrol-setup.py
```

Das Script:
1. Liest die YControl-Seriennummer (`/boot/firmware/ycontrolSN.txt`)
2. Registriert das Gerät in der Cloud (wartet auf Admin-Freigabe)
3. Installiert den Agent als systemd-Dienst
4. Verbindet sich per MQTT und sendet Telemetrie

### Gerät freigeben

Im Cloud-UI unter **Geräte** → Gerät in der Liste → **Freigeben**.

### VPN auf dem Pi aktivieren (optional)

1. Im UI: **VPN → Anlagen-VPN → Anlage aktivieren** (LAN-Präfix eingeben, z.B. `192.168.10`)
2. Das Gerät muss der Anlage zugeordnet sein (**Geräte → Anlage zuweisen**)
3. Deploy-Button (📥-Icon) in der Anlagen-Zeile klicken
4. Der Agent auf dem Pi empfängt den `vpn_install`-Befehl, installiert WireGuard automatisch und verbindet sich

---

## 14. Nützliche Befehle im Alltag

### Status & Übersicht

```bash
# Alle Container anzeigen
docker compose -f docker-compose.prod.yml ps

# Ressourcenverbrauch (CPU, RAM) live
docker stats --no-stream
```

### Logs

```bash
# Alle Logs live verfolgen
docker compose -f docker-compose.prod.yml logs -f

# Nur Backend (letzte 100 Zeilen)
docker compose -f docker-compose.prod.yml logs --tail=100 backend

# MQTT Broker
docker compose -f docker-compose.prod.yml logs --tail=50 mqtt

# WireGuard VPN
docker compose -f docker-compose.prod.yml logs --tail=50 wireguard

# Cloudflare Tunnel
docker compose -f docker-compose.prod.yml logs --tail=50 cloudflared
```

### In Container verbinden

```bash
# Shell im Backend
docker compose -f docker-compose.prod.yml exec backend sh

# PostgreSQL-Konsole
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres ycontrol_cloud

# WireGuard Status
docker compose -f docker-compose.prod.yml exec wireguard wg show
```

### Services steuern

```bash
# Einen Service neu starten
docker compose -f docker-compose.prod.yml restart backend

# Alle Services stoppen
docker compose -f docker-compose.prod.yml down

# Alle Services starten
docker compose -f docker-compose.prod.yml up -d

# ⚠️ Alles stoppen UND Daten löschen (unwiderruflich!)
docker compose -f docker-compose.prod.yml down -v
```

### Datenbank

```bash
# Backup erstellen
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres ycontrol_cloud > backup_$(date +%Y%m%d_%H%M%S).sql

# Backup wiederherstellen
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres ycontrol_cloud < backup_20240101_120000.sql
```

### Speicherplatz

```bash
# Nicht mehr benötigte Docker-Daten aufräumen
docker system prune -f

# Speicherbelegung anzeigen
docker system df
```

---

## 15. Backup-Konzept & automatisches Backup

Das Backup-System läuft **direkt im Backend** und sichert ins Swift-Target (Infomaniak Swiss Backup) – keine separaten Cron-Jobs nötig.

### Was wird gesichert?

Zwei unabhängige Backup-Mechanismen:

| Was | Wo eingerichtet | Inhalt | Ziel |
|---|---|---|---|
| **Geräte-Backups** | Gerät → Detail → Backup-Karte | SQLite-DB des Pi + assets-Ordner | Swift `<serial>/<iso>.tar.gz` |
| **Cloud-Gesamt-Backup** | Einstellungen → Backups → Cloud-DB-Backup | `pg_dump` + `/app/uploads/` (Fotos, Wiki) | Swift `cloud/<iso>.tar.gz` |

Beide landen im selben Swift-Container, aber mit unterschiedlichen Präfixen.

### Konfiguration

**Swift-Target:** Einstellungen → Backups → **Infomaniak Swiss Backup (Swift)**
Zugangsdaten aus dem Infomaniak-Manager (Swiss Backup → Swift-Zugang), einmal eintragen und "Verbindung testen".

**Auto-Backup pro Gerät:**
- Setting "Auto-Backup enabled" / Intervall in Minuten (Default 1440 = 24 h)
- Scheduler pollt alle 2 min, triggert ein Backup wenn die lokale Config-Änderung auf dem Pi älter als das Intervall ist und noch kein Backup seit der Änderung existiert.
- Pro Gerät einzeln abschaltbar (Schalter in der Device-Backup-Karte).
- Retention: 5 neueste OK-Backups + 1 "pinned" Backup (manuell fixiert, überlebt Rotation).

**Cloud-Backup:**
- Setting "Cloud-DB-Backup enabled" + Intervall (h, Default 24) + Retention (Tage, Default 14).
- Scheduler pollt stündlich, dumpt die gesamte Cloud-DB als Custom-Format + bündelt die Uploads (`/app/uploads/`) in ein einziges `tar.gz`.
- Manueller Trigger via Admin-UI-Button.
- Retention: OK-Backups > N Tage werden nach jedem neuen erfolgreichen Dump gelöscht (Swift + DB-Row).

### Daten at rest

- **SystemSettings**: sensible Keys (S3/Swift-Passwords, SMTP-Password, Twilio-Token, DeepL-Key) sind mit AES-256-GCM verschlüsselt. Master-Key = `SECRETS_KEY` env. **Unbedingt** extern sicher aufbewahren (Password-Manager) – ohne den Key keine Entschlüsselung nach einer Wiederherstellung.
- Swift-Container: Infomaniak Swiss Backup, 3× Replikation in CH-Datacenter.

---

## 16. Server wiederherstellen (Disaster Recovery)

Wenn der Server komplett weg ist (Hardware-Crash, Kompromittierung, Migration auf neuen VPS), so kommst du zurück zum laufenden Zustand. Voraussetzungen:

- **Zugriff** auf den Infomaniak-Manager (für Swift-Credentials)
- **Das letzte Cloud-Backup-Bundle** (lokal oder direkt aus Swift herunterladen)
- **`SECRETS_KEY`** aus dem Password-Manager (entschlüsselt die sensiblen Settings im Dump)
- **Alle `.env`-Secrets** (`JWT_*`, `MQTT_*`, `DB_PASSWORD`, `CLOUDFLARE_TUNNEL_TOKEN`, `SECRETS_KEY`, `VPN_SERVER_PRIVATE_KEY`)

### Schritt 1 – Frische VPS aufsetzen

Genauso wie bei einer Erstinstallation ([Kapitel 2-10](#2-vps-vorbereiten)). Bis und mit `./install.sh` durchlaufen, damit der Stack grundsätzlich läuft (leere DB, keine Uploads, leere WireGuard-Configs). Dann den Server kurz stoppen:

```bash
cd /opt/ycontrol
docker compose -f docker-compose.prod.yml stop backend
```

### Schritt 2 – Bundle besorgen

Falls du noch einen Browser-Zugriff auf den alten Server hast: Einstellungen → Backups → Cloud-DB-Backup → Download.

Falls nicht, direkt aus Swift holen (Infomaniak-Manager → Swiss Backup → Swift → File-Browser, oder per `swift`/`rclone` CLI):

```bash
# mit rclone (einmalig mit 'rclone config' die swiss-backup-Verbindung anlegen)
rclone lsf swiss-backup:<container-name>/cloud/ | sort | tail -5
rclone copy swiss-backup:<container-name>/cloud/<YYYY-MM-DD>...tar.gz ./restore/
```

Das Bundle auf den neuen Server kopieren:

```bash
scp restore/cloud-*.tar.gz ycontrol@<neuer-server>:/tmp/
```

### Schritt 3 – Bundle auspacken

```bash
ssh ycontrol@<neuer-server>
mkdir -p /tmp/ycrestore && cd /tmp/ycrestore
tar xzf /tmp/cloud-*.tar.gz
ls -la
# → db.dump     (Custom-Format pg_dump)
# → uploads/    (Fotos + Wiki-Anhänge)
```

### Schritt 4 – Datenbank wiederherstellen

Der Backup-Stack ist aus `./install.sh` schon hochgezogen, die DB ist leer initialisiert. Wir fahren das Backend runter (damit keine neuen Writes reinkommen), `pg_restore` in die frische DB, Backend wieder hoch:

```bash
cd /opt/ycontrol

# Backend stoppen (Postgres läuft weiter)
docker compose -f docker-compose.prod.yml stop backend

# DB-Inhalt komplett wegkicken und aus dem Dump wiederherstellen.
# --clean + --if-exists: bestehende Objekte werden zuerst gedropt,
# --no-owner + --no-privileges: Besitzer/Grants vom alten Server werden
# nicht übernommen (die Rolle 'postgres' im neuen Container existiert).
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists --no-owner --no-privileges \
  --username=postgres --dbname=ycontrol_cloud \
  < /tmp/ycrestore/db.dump

# Kurz prüfen dass Tabellen da sind
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d ycontrol_cloud -c "\\dt" | head -20
```

### Schritt 5 – Uploads ins Volume zurückspielen

```bash
# Backend-Container (gestoppt) ist OK zum cp rein – docker cp funktioniert auch im Stopped-State.
docker compose -f docker-compose.prod.yml cp \
  /tmp/ycrestore/uploads/. ycontrol_backend:/app/uploads/

# Rechte stimmen lassen (der Node-Prozess im Container läuft als root):
docker compose -f docker-compose.prod.yml exec -u 0 -T backend chown -R node:node /app/uploads || true
```

### Schritt 6 – Backend starten & verifizieren

```bash
docker compose -f docker-compose.prod.yml up -d backend
docker compose -f docker-compose.prod.yml logs -f backend | head -40
```

Im Log erwartest du:
```
[secrets-migration] 0 sensible Settings-Werte verschlüsselt   (schon alles enc:v1:)
✓ Server running on http://0.0.0.0:3000
✓ MQTT service initializing...
✓ Auto-Backup-Scheduler gestartet
✓ Cloud-Backup-Scheduler gestartet
```

**Web-UI aufrufen** (die Cloudflare-Tunnel-Config ist schon aktiv durch den Compose-Stack): Login mit dem Admin-Passwort vom **alten** Server.

### Schritt 7 – Raspberry Pis wieder verbinden

Jeder Pi hat sein Device-Secret lokal in `/etc/ycontrol/config.json`. Nach dem Restore:

- **MQTT-Server**: dieselbe URL (aus `pi.mqttHost`-Setting, wird von der DB gelesen) → Pis connecten sich von selbst wieder.
- **VPN**: die `VpnDevice`-Zuweisungen sind in der DB; der WireGuard-Container regeneriert die `wg0.conf` beim Start aus der DB. **Aber**: der Server-Private-Key muss derselbe sein wie beim Erstellen der Client-Configs (steht in `.env` als `VPN_SERVER_PRIVATE_KEY`).
- **Pi-Agent-Updates**: einmal "Agent aktualisieren" aus dem UI drücken, falls der Agent-Version-Unterschied störend ist.

Falls ein Pi nach 10-15 Min nicht zurückkommt, den `setup.sh` auf dem Pi erneut laufen lassen (das bestehende Secret bleibt erhalten, nur die MQTT-Verbindung wird refreshed).

### Schritt 8 – Cloud-Backup wieder aktivieren & sofort testen

Einstellungen → Backups → Cloud-DB-Backup → Jetzt Backup erstellen → sollte nach 1-3 Min auf OK wechseln. Damit hast du verifiziert dass:
- die Swift-Connection funktioniert
- `SECRETS_KEY` die Credentials entschlüsseln konnte
- `pg_dump` + tar laufen

### Was dabei NICHT wiederhergestellt wird

- **Activity-Log**: ist in der DB, wird mitgesichert — `OK`
- **Wiki-Anhänge + Anlagen-Fotos**: in `/app/uploads`, wird mitgesichert — `OK`
- **JWT-Refresh-Tokens**: die aktuellen Browser-Sessions werden invalid, User müssen sich neu einloggen — `normal`
- **Cloudflare-Tunnel-Token**: bleibt derselbe (in `.env`), keine Aktion nötig
- **Laufende MQTT-Subscriptions**: die Retained-Messages der Pis kommen mit dem ersten neuen Pi-Connect zurück

### Bei komplett verlorener `.env`

Dann ist Game Over für:
- `SECRETS_KEY` → verschlüsselte Settings (Swift-Password, SMTP, Twilio, DeepL) nicht lesbar, manuell neu setzen
- `JWT_*_SECRET` → neue Secrets generieren (alle User müssen sich neu einloggen)
- `DB_PASSWORD` → kann frei gewählt werden (Postgres-Volume ist auch weg)
- `VPN_SERVER_PRIVATE_KEY` → **alle Pi-VPN-Configs werden ungültig**, jeder Pi muss mit neuer Config erneut verbunden werden.

Deshalb: **`.env` IMMER im Password-Manager ablegen**, nicht nur auf dem Server.

---

## 17. Fehlerbehebung

### Problem: Seite nicht erreichbar

```bash
# 1. Läuft cloudflared?
docker compose -f docker-compose.prod.yml ps cloudflared
docker compose -f docker-compose.prod.yml logs cloudflared | tail -30

# 2. Läuft das Frontend?
docker compose -f docker-compose.prod.yml ps frontend

# 3. Direkt testen
docker compose -f docker-compose.prod.yml exec cloudflared \
  wget -qO- http://frontend:80 | head -5
```

**Häufige Ursachen:**

| Symptom | Ursache | Lösung |
|---------|---------|--------|
| cloudflared `exited` | Falsches Token in `.env` | Token in Cloudflare Dashboard prüfen, `.env` korrigieren, `docker compose restart cloudflared` |
| `ERR_TUNNEL_CONNECTION_FAILED` | cloudflared läuft nicht | `docker compose -f docker-compose.prod.yml up -d cloudflared` |
| Seite lädt, aber weiß | Frontend Build-Fehler | `docker compose logs frontend` prüfen |
| Login schlägt fehl | Backend nicht erreichbar | `docker compose logs backend` prüfen |

---

### Problem: Backend startet nicht

```bash
docker compose -f docker-compose.prod.yml logs backend
```

| Fehlermeldung | Lösung |
|---------------|--------|
| `Environment variable not found` | `.env` Variablen fehlen oder falsch geschrieben |
| `Connection refused` (DB) | PostgreSQL noch nicht bereit – kurz warten, dann `docker compose restart backend` |
| `Migration failed` | `docker compose logs postgres` prüfen |

---

### Problem: MQTT-Verbindung vom Pi schlägt fehl

```bash
# Port 1883 erreichbar?
nc -zv DEINE-VPS-IP 1883
# → "succeeded" muss erscheinen

# Mosquitto läuft?
docker compose -f docker-compose.prod.yml ps mqtt
docker compose -f docker-compose.prod.yml logs mqtt | tail -20

# Firewall prüfen
sudo ufw status | grep 1883
```

---

### Problem: WireGuard VPN funktioniert nicht

```bash
# WireGuard-Container läuft?
docker compose -f docker-compose.prod.yml ps wireguard
docker compose -f docker-compose.prod.yml logs wireguard | tail -30

# WireGuard-Interface anzeigen
docker compose -f docker-compose.prod.yml exec wireguard wg show

# Port 51820 erreichbar? (UDP-Test vom Techniker-PC)
nc -u -zv DEINE-VPS-IP 51820

# Firewall prüfen
sudo ufw status | grep 51820

# Konfig manuell neu laden
docker kill --signal SIGHUP ycontrol_wireguard
```

**Häufige Ursachen:**

| Symptom | Ursache | Lösung |
|---------|---------|--------|
| `wg0.conf` fehlt | `VPN_SERVER_PRIVATE_KEY` nicht in `.env` | Schlüssel generieren und in `.env` eintragen, Backend neu starten |
| Pi verbindet sich nicht | Server-Endpunkt falsch im UI | VPN → Einstellungen → Endpunkt auf `IP:51820` setzen |
| Kein Zugriff auf Anlagen-LAN | NETMAP-Regeln fehlen | `wg show` auf Pi prüfen, `wg-quick down/up wg0` |

---

### Problem: Pi-Registrierung schlägt fehl

```bash
# Backend-Logs während Registrierung ansehen
docker compose -f docker-compose.prod.yml logs -f backend

# Health-Check
curl https://cloud.deine-domain.de/health
```

---

### System-Info für Support

```bash
echo "=== OS ===" && lsb_release -a
echo "=== Docker ===" && docker --version
echo "=== Compose ===" && docker compose version
echo "=== Container ===" && docker compose -f docker-compose.prod.yml ps
echo "=== Disk ===" && df -h /
echo "=== RAM ===" && free -h
echo "=== Tunnel ===" && docker compose -f docker-compose.prod.yml logs --tail=10 cloudflared
echo "=== WireGuard ===" && docker compose -f docker-compose.prod.yml exec wireguard wg show 2>/dev/null || echo "nicht verfügbar"
```

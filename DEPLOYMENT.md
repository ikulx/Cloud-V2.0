# Ycontrol Cloud – Deployment Anleitung

> **Zugang von außen:** Cloudflare Tunnel (`cloudflared`)
> Kein offener Port 80/443 nötig. HTTPS und Zertifikate übernimmt Cloudflare automatisch.
> Der einzige Port der nach außen offen sein muss ist **1883** (MQTT für Raspberry Pi).

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
9. [Erstinstallation starten](#9-erstinstallation-starten)
10. [Testen ob alles läuft](#10-testen-ob-alles-läuft)
11. [Update einspielen](#11-update-einspielen)
12. [Nützliche Befehle im Alltag](#12-nützliche-befehle-im-alltag)
13. [Automatisches Backup einrichten](#13-automatisches-backup-einrichten)
14. [Fehlerbehebung](#14-fehlerbehebung)

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
┌─────────────────────────────────────────────────────┐
│  VPS (keine eingehenden Ports 80/443 nötig!)        │
│                                                     │
│  ┌─────────────┐    ┌──────────────┐               │
│  │ cloudflared │───▶│  frontend:80 │ (nginx)        │
│  │  (Tunnel)   │    │  /api/* ────▶│  backend:3000  │
│  └─────────────┘    └──────────────┘               │
│                                                     │
│  ┌──────────────┐   ┌──────────────┐               │
│  │  backend     │   │  postgres    │               │
│  │  :3000       │───│  :5432       │               │
│  └──────────────┘   └──────────────┘               │
│                                                     │
│  Port 1883 offen ──▶ emqx (MQTT für Raspberry Pi)  │
└─────────────────────────────────────────────────────┘
```

**Vorteile gegenüber direktem Port-Öffnen:**
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
**nicht** geöffnet werden. Nur MQTT braucht einen direkten Port.

```bash
# SSH immer offen lassen!
sudo ufw allow 22/tcp

# MQTT für Raspberry Pi Geräte
sudo ufw allow 1883/tcp

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
```

> **Port 18083 (EMQX Dashboard)** bleibt geschlossen. Zugriff nur per SSH-Tunnel:
> ```bash
> # Auf dem eigenen PC ausführen:
> ssh -L 18083:localhost:18083 root@DEINE-VPS-IP
> # Dann im Browser öffnen: http://localhost:18083
> ```

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

> **Wichtig:** Den Token wie ein Passwort behandeln. Wer den Token hat,
> kann Verbindungen durch den Tunnel schicken.

### Schritt 5: Public Hostname konfigurieren

Im nächsten Schritt „Route tunnel" → Tab **„Public Hostname"**:

| Feld | Wert |
|------|------|
| Subdomain | `cloud` |
| Domain | `deine-domain.de` |
| Type | `HTTP` |
| URL | `frontend:80` |

→ **„Save tunnel"** klicken

Das war es. Cloudflare leitet jetzt `https://cloud.deine-domain.de` durch den
Tunnel auf den `frontend`-Container (Port 80) weiter.
Das HTTPS-Zertifikat erstellt Cloudflare automatisch.

> **Warum `frontend:80` und nicht `localhost:80`?**
> `cloudflared` läuft im selben Docker-Netzwerk wie die anderen Container.
> `frontend` ist der interne Docker-Containername, der direkt auflösbar ist.

---

## 7. Code auf den Server bringen

### Option A: Per Git (empfohlen – ermöglicht einfache Updates)

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

### Option B: Per SCP hochladen (ohne Git)

```bash
# Auf dem lokalen Windows-PC in PowerShell / CMD:
scp -r "D:\Entwicklung\Ycontrol-Cloud_2026\Cloud V2.0" root@DEINE-VPS-IP:/opt/ycontrol

# Dann auf dem VPS:
cd /opt/ycontrol
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

Diese Befehle ausführen und die Ausgaben notieren:

```bash
echo "DB_PASSWORD:            $(openssl rand -hex 32)"
echo "JWT_ACCESS_SECRET:      $(openssl rand -hex 64)"
echo "JWT_REFRESH_SECRET:     $(openssl rand -hex 64)"
echo "MQTT_AUTH_SECRET:       $(openssl rand -hex 32)"
echo "MQTT_BACKEND_PASSWORD:  $(openssl rand -hex 32)"
echo "EMQX_DASHBOARD_PASSWORD:$(openssl rand -hex 16)"
```

### Schritt 3: .env bearbeiten

```bash
nano .env
```

Alle Felder ausfüllen:

```env
# Cloudflare Tunnel Token (aus Schritt 6, Punkt 4)
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYTR...der-lange-token-aus-cloudflare...

# App URL (so wie in Cloudflare konfiguriert)
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
EMQX_DASHBOARD_PASSWORD=<aus openssl rand -hex 16>
```

Speichern: `Strg + O` → `Enter` → `Strg + X`

### Schritt 4: Prüfen ob alle Werte gesetzt sind

```bash
grep "AENDERN_" .env
# Erwartete Ausgabe: leer (keine Treffer)
```

---

## 9. Erstinstallation starten

```bash
./install.sh
```

**Was das Skript macht:**

```
[INFO]  Prüfe Voraussetzungen...
[OK]    Docker & Docker Compose verfügbar
[OK]    .env gefunden und vollständig
[INFO]  Erstelle emqx/ Konfigurationsverzeichnis...
[INFO]  Baue Docker Images (ca. 3-5 Minuten beim ersten Mal)...
[OK]    Images gebaut
[INFO]  Starte PostgreSQL...
[INFO]  Starte alle Services...
[OK]    Alle Services gestartet
[INFO]  Warte auf Backend (Migrations + Seed)...
[OK]    Seed ausgeführt
[OK]    Cloudflare Tunnel läuft

╔══════════════════════════════════════════════════════════════╗
║          Installation abgeschlossen!                         ║
╚══════════════════════════════════════════════════════════════╝

  🌐 App:      https://cloud.deine-domain.de
  Standard-Login:
    E-Mail:    admin@example.com
    Passwort:  Admin1234!  ← bitte sofort ändern!
```

**Was im Hintergrund passiert:**
1. PostgreSQL startet und wird gesund
2. EMQX (MQTT-Broker) startet
3. Backend startet → `prisma migrate deploy` erstellt alle Tabellen
4. Backend führt Seed aus (Admin-User, Rollen, Permissions)
5. Frontend (nginx) startet mit der gebauten React-App
6. `cloudflared` startet und verbindet sich mit Cloudflare → App ist sofort über `https://cloud.deine-domain.de` erreichbar

---

## 10. Testen ob alles läuft

### Container-Status prüfen

```bash
docker compose -f docker-compose.prod.yml ps
```

Alle Container müssen `running` oder `healthy` sein:

```
NAME                    STATUS
ycontrol_postgres       running (healthy)
ycontrol_emqx           running (healthy)
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
... Connection ... registered connIndex=1 ...
```
(cloudflared baut normalerweise 4 parallele Verbindungen auf)

### Im Browser öffnen

```
https://cloud.deine-domain.de
```

→ Login-Seite erscheint mit Cloudflare-HTTPS-Schloss ✓

### Health-Check aufrufen

```bash
curl https://cloud.deine-domain.de/health
# Erwartete Ausgabe: {"status":"ok"}
```

### Einloggen und Passwort ändern

1. E-Mail: `admin@example.com`
2. Passwort: `Admin1234!`
3. Sofort zu **Profil / Einstellungen** navigieren und Passwort ändern

---

## 11. Update einspielen

### Auf dem lokalen Entwicklungsrechner

```bash
# Änderungen committen und pushen
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
| 1 | `git pull` – neue Commits holen |
| 2 | Docker Images neu bauen (nur veränderte Teile dank Cache) |
| 3 | Backend neu starten → `prisma migrate deploy` läuft automatisch |
| 4 | Frontend neu starten |
| 5 | cloudflared läuft weiter (kein Neustart nötig) |
| 6 | Alte Images aufräumen |

> **Downtime:** Backend ca. 5–15 Sekunden. Frontend ca. 0 Sekunden.
> Der Cloudflare Tunnel bleibt während des Updates aktiv.

### Update ohne git pull

```bash
# Z.B. nach manuellem Datei-Upload per SCP
./deploy.sh --skip-pull
```

### Nur ein einzelnes Service neu starten

```bash
# Nur Backend (z.B. nach .env-Änderung)
docker compose -f docker-compose.prod.yml up -d --no-deps backend

# Nur Frontend
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d --no-deps frontend
```

### Cloudflare Tunnel Token ändern

Falls ein neues Token nötig ist (z.B. Sicherheitsvorfall):

1. Im Cloudflare Zero Trust Dashboard: **Networks → Tunnels → Tunnel auswählen → Configure**
2. Unter **„Credentials"** ein neues Token generieren
3. Neues Token in `.env` eintragen: `CLOUDFLARE_TUNNEL_TOKEN=neues-token`
4. `docker compose -f docker-compose.prod.yml restart cloudflared`

---

## 12. Nützliche Befehle im Alltag

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

# Cloudflare Tunnel Verbindungsstatus
docker compose -f docker-compose.prod.yml logs --tail=50 cloudflared

# Mit Zeitstempel
docker compose -f docker-compose.prod.yml logs -f --timestamps backend
```

### In Container verbinden

```bash
# Shell im Backend
docker compose -f docker-compose.prod.yml exec backend sh

# PostgreSQL-Konsole
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres ycontrol_cloud

# EMQX Dashboard (SSH-Tunnel auf lokalem PC öffnen, dann Browser)
ssh -L 18083:localhost:18083 root@DEINE-VPS-IP
# → http://localhost:18083
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

## 13. Automatisches Backup einrichten

```bash
# Backup-Verzeichnis erstellen
sudo mkdir -p /opt/backups
sudo chown $USER:$USER /opt/backups

# Crontab bearbeiten
crontab -e
```

Folgende Zeilen einfügen:

```cron
# Täglich 03:00 Uhr: Datenbankbackup (komprimiert)
0 3 * * * cd /opt/ycontrol && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U postgres ycontrol_cloud | gzip > /opt/backups/db_$(date +\%Y\%m\%d).sql.gz 2>> /opt/backups/backup.log

# Täglich 04:00 Uhr: Backups älter als 30 Tage löschen
0 4 * * * find /opt/backups -name "db_*.sql.gz" -mtime +30 -delete
```

Testen:

```bash
# Backup manuell auslösen
cd /opt/ycontrol && docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres ycontrol_cloud | gzip > /opt/backups/test.sql.gz

# Ergebnis prüfen
ls -lh /opt/backups/
```

---

## 14. Fehlerbehebung

### Problem: Seite nicht erreichbar

```bash
# 1. Läuft cloudflared?
docker compose -f docker-compose.prod.yml ps cloudflared

# 2. Cloudflare Tunnel Logs ansehen
docker compose -f docker-compose.prod.yml logs cloudflared | tail -30

# 3. Läuft das Frontend?
docker compose -f docker-compose.prod.yml ps frontend

# 4. Direkt vom VPS aus testen (geht am Tunnel vorbei)
curl http://localhost  # sollte nicht funktionieren (kein Port gebunden)
# Stattdessen:
docker compose -f docker-compose.prod.yml exec cloudflared \
  wget -qO- http://frontend:80 | head -5
```

**Häufige Ursachen:**
| Symptom | Ursache | Lösung |
|---------|---------|--------|
| cloudflared `exited` | Falsches Token in `.env` | Token in Cloudflare Dashboard prüfen, `.env` korrigieren, `docker compose restart cloudflared` |
| `ERR_TUNNEL_CONNECTION_FAILED` | cloudflared läuft nicht | `docker compose -f docker-compose.prod.yml up -d cloudflared` |
| Seite lädt, aber weiß | Frontend Build-Fehler | `docker compose logs frontend` prüfen |
| Login schlägt fehl (API-Fehler) | Backend nicht erreichbar | `docker compose logs backend` prüfen |

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

### Problem: MQTT Verbindung vom Raspberry Pi schlägt fehl

```bash
# Port 1883 erreichbar?
# Auf dem Pi oder lokalem PC:
nc -zv DEINE-VPS-IP 1883
# → "succeeded" muss erscheinen

# EMQX läuft?
docker compose -f docker-compose.prod.yml ps emqx
docker compose -f docker-compose.prod.yml logs emqx | tail -20

# Firewall prüfen
sudo ufw status | grep 1883
```

---

### Problem: Update schlägt fehl

```bash
# Images ohne Cache neu bauen
docker compose -f docker-compose.prod.yml build --no-cache

# Dann neu starten
docker compose -f docker-compose.prod.yml up -d
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
```

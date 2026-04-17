import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { buildVisibleDevicesWhere } from '../lib/access-filter'
import { generateDeviceSecret, hashDeviceSecret } from '../lib/token'
import { publishCommand, kickMqttClient, clearRetainedMessages } from '../services/mqtt.service'
import { env } from '../config/env'
import { getSetting } from './settings.router'

const router = Router()

const deviceSchema = z.object({
  name: z.string().min(1).max(200),
  serialNumber: z.string().min(1).max(100),
  ipAddress: z.string().optional(),
  firmwareVersion: z.string().optional(),
  projectNumber: z.string().optional(),
  schemaNumber: z.string().optional(),
  notes: z.string().optional(),
  anlageIds: z.array(z.string().uuid()).optional(),
  userIds: z.array(z.string().uuid()).optional(),
  groupIds: z.array(z.string().uuid()).optional(),
})

const todoSchema = z.object({ title: z.string().min(1), details: z.string().optional() })
const todoUpdateSchema = z.object({ status: z.enum(['OPEN', 'DONE']) })
const logSchema = z.object({ message: z.string().min(1) })

const deviceInclude = {
  anlageDevices: { include: { anlage: { select: { id: true, name: true } } } },
  directUsers: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
  directGroups: { include: { group: { select: { id: true, name: true } } } },
  _count: { select: { todos: { where: { status: 'OPEN' as const } } } },
  vpnDevice: { select: { vpnIp: true } },
  parentDevice: { select: { id: true, name: true } },
  childDevices: { select: { id: true, name: true, lanTargetIp: true, lanTargetPort: true } },
}

// ─── Setup Script (Python Agent) ─────────────────────────────────────────────

const SETUP_SCRIPT_TEMPLATE = `#!/usr/bin/env python3
"""
YControl Cloud - Raspberry Pi Agent v2
Generiert: <<GENERATED_AT>>

Setup (einmalig, als root):
  sudo python3 ycontrol-setup.py

Der Agent laeuft danach als systemd-Dienst und:
  - verbindet sich per MQTT mit dem Cloud-Broker
  - meldet sich automatisch als ONLINE/OFFLINE (LWT)
  - sendet Versionsinformationen und lokale IP
  - empfaengt und beantwortet Remote-Befehle
"""
import json, os, sys, socket, signal, subprocess, shutil, stat, time, threading
import urllib.request as urlreq
import urllib.error   as urlerr
import http.client    as httplib

# ─── IPv4 erzwingen (verhindert "Network is unreachable" bei IPv6-Auflösung) ──
_orig_getaddrinfo = socket.getaddrinfo
def _ipv4_only(host, port, family=0, type=0, proto=0, flags=0):
    return _orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = _ipv4_only

# ─── Konstanten ──────────────────────────────────────────────────────────────
AGENT_VERSION = "1.0.0-RC18"  # Router-Erkennung: hasRouter, piLanIp, piWanIp in Telemetrie
SERVER_URL    = "<<SERVER_URL>>"
MQTT_HOST     = "<<MQTT_HOST>>"
MQTT_PORT     = <<MQTT_PORT>>
CONFIG_PATH   = "/etc/ycontrol/config.json"
AGENT_PATH    = "/usr/local/bin/ycontrol-agent.py"
SERVICE_PATH  = "/etc/systemd/system/ycontrol-agent.service"
SQLITE_DB     = "/home/pi/ycontrol-data/external/ycontroldata_settings.sqlite"

# ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
def get_ycontrol_sn():
    try:
        with open("/boot/firmware/ycontrolSN.txt") as f:
            sn = f.read().strip()
            if sn:
                return sn
    except Exception:
        pass
    return None

def get_pi_serial():
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("Serial"):
                    return line.split(":")[1].strip().upper()
    except Exception:
        pass
    return socket.gethostname()

def get_serial():
    return get_ycontrol_sn() or get_pi_serial()

def _sqlite_read(var_name):
    """Liest einen Wert aus QHMI_VARIABLES."""
    try:
        import sqlite3
        with sqlite3.connect(SQLITE_DB) as conn:
            row = conn.execute(
                "SELECT VAR_VALUE FROM QHMI_VARIABLES WHERE NAME = ? LIMIT 1", (var_name,)
            ).fetchone()
            val = row[0].strip() if row and row[0] else None
            return val if val else None
    except Exception as e:
        print("[YControl] SQLite-Lesefehler (" + var_name + "): " + str(e), file=sys.stderr)
        return None

def _sqlite_write(var_name, value):
    """Schreibt einen Wert in QHMI_VARIABLES."""
    try:
        import sqlite3
        with sqlite3.connect(SQLITE_DB) as conn:
            conn.execute(
                "UPDATE QHMI_VARIABLES SET VAR_VALUE = ? WHERE NAME = ?", (value, var_name)
            )
            conn.commit()
        return True
    except Exception as e:
        print("[YControl] SQLite-Schreibfehler: " + str(e), file=sys.stderr)
        return False

def get_anlage_name():    return _sqlite_read("SYS01_DB_Anlagenamen")
def set_anlage_name(v):   return _sqlite_write("SYS01_DB_Anlagenamen", v)
def get_project_number(): return _sqlite_read("SYS01_DB_Projektnummer")
def get_schema_number():  return _sqlite_read("SYS01_DB_Schemanummer")

def get_visu_version():
    """Liest die Docker-Image-Version des ycontrol-rt Containers."""
    try:
        result = subprocess.run(
            ["docker", "inspect", "ycontrol-rt", "--format", "{{.Config.Image}}"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            image = result.stdout.strip()
            # "ikulx/y-vis3:v0.0.1-rc263" → "y-vis3:v0.0.1-rc263"
            if "/" in image:
                image = image.split("/", 1)[1]
            return image if image else None
    except Exception:
        pass
    return None

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "unknown"

def get_vpn_status():
    """Prueft ob WireGuard (wgyc) einen aktuellen Handshake hat (< 180s)."""
    try:
        r = subprocess.run(["wg", "show", "wgyc", "latest-handshakes"],
                           capture_output=True, text=True, timeout=3)
        if r.returncode != 0:
            return False
        now = int(time.time())
        for line in r.stdout.strip().splitlines():
            parts = line.split()
            if len(parts) >= 2:
                try:
                    ts = int(parts[-1])
                    if ts > 0 and (now - ts) < 180:
                        return True
                except ValueError:
                    continue
        return False
    except Exception:
        return False

def get_http_status():
    """Prüft ob der ycontrol-rt Docker-Container läuft."""
    try:
        r = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Running}}", "ycontrol-rt"],
            capture_output=True, text=True, timeout=3
        )
        return r.returncode == 0 and r.stdout.strip() == "true"
    except Exception:
        return False

def get_router_info():
    """Erkennt ob die Ycontrol-Router-Software installiert ist und liest LAN/WAN-IPs aus."""
    info = {"hasRouter": False, "piLanIp": None, "piWanIp": None}
    # Router-Software erkennen: systemd-Service oder Node-Prozess
    try:
        r = subprocess.run(["systemctl", "is-active", "ycontrol-router"],
                           capture_output=True, text=True, timeout=3)
        if r.returncode == 0 and r.stdout.strip() == "active":
            info["hasRouter"] = True
    except Exception:
        pass
    if not info["hasRouter"]:
        try:
            r = subprocess.run(["pgrep", "-f", "router-ui/server.js"],
                               capture_output=True, text=True, timeout=3)
            if r.returncode == 0 and r.stdout.strip():
                info["hasRouter"] = True
        except Exception:
            pass
    if not info["hasRouter"]:
        # Fallback: Prüfe ob das Router-UI-Verzeichnis existiert
        if os.path.isfile("/opt/ycontrol-router/server.js") or os.path.isfile("/home/pi/router-ui/server.js"):
            info["hasRouter"] = True
    if not info["hasRouter"]:
        return info
    # LAN-IP: br-lan oder br0 Interface (typisch fuer Router-Software)
    for iface in ["br-lan", "br0", "eth1"]:
        try:
            r = subprocess.run(["ip", "-4", "addr", "show", iface],
                               capture_output=True, text=True, timeout=3)
            if r.returncode == 0:
                import re
                m = re.search(r"inet (\\d+\\.\\d+\\.\\d+\\.\\d+)", r.stdout)
                if m:
                    info["piLanIp"] = m.group(1)
                    break
        except Exception:
            pass
    # WAN-IP: eth0 Interface (Uplink-Netzwerk)
    for iface in ["eth0", "wlan0"]:
        try:
            r = subprocess.run(["ip", "-4", "addr", "show", iface],
                               capture_output=True, text=True, timeout=3)
            if r.returncode == 0:
                import re
                m = re.search(r"inet (\\d+\\.\\d+\\.\\d+\\.\\d+)", r.stdout)
                if m:
                    ip = m.group(1)
                    # Nicht die VPN-IP oder Loopback
                    if not ip.startswith("10.") and not ip.startswith("127."):
                        info["piWanIp"] = ip
                        break
        except Exception:
            pass
    return info

_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; YControl-Agent/2.0)",
}

def api_post(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urlreq.Request(url, data=data, headers=_HEADERS, method="POST")
    try:
        with urlreq.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read()), resp.status
    except urlerr.HTTPError as e:
        raw = b""
        try:
            raw = e.read()
            return json.loads(raw), e.code
        except Exception:
            preview = raw[:200].decode("utf-8", errors="replace")
            return {"error": "HTTP " + str(e.code) + " – keine JSON-Antwort", "preview": preview}, e.code
    except Exception as e:
        return {"error": str(e)}, 0

def api_get(url):
    req = urlreq.Request(url, headers={"User-Agent": _HEADERS["User-Agent"]}, method="GET")
    try:
        with urlreq.urlopen(req, timeout=10) as resp:
            return resp.status
    except urlerr.HTTPError as e:
        return e.code
    except Exception:
        return 0

# ─── AGENT-MODUS ──────────────────────────────────────────────────────────────
def periodic_reregister(cfg_path):
    """Meldet sich periodisch bei der Cloud, damit die Cloud piSerial-Konflikte erkennen
    und Hardware-Wechsel registrieren kann. Kein Self-Update des Scripts."""
    while True:
        time.sleep(1800)  # alle 30 Minuten
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            server_url = cfg.get("serverUrl", SERVER_URL)
            url = server_url.rstrip("/") + "/api/devices/register"
            payload = {"serialNumber": cfg["serialNumber"], "piSerial": get_pi_serial()}
            result, code = api_post(url, payload)
            if code == 409:
                print("[YControl] Re-Register: KONFLIKT – YControl-SN bereits anderem Pi zugeordnet.", file=sys.stderr)
            elif code not in (200, 201):
                print("[YControl] Re-Register Fehler (HTTP " + str(code) + "): " + str(result), file=sys.stderr)
        except Exception as ex:
            print("[YControl] Re-Register Exception: " + str(ex), file=sys.stderr)

def run_agent():
    if not os.path.exists(CONFIG_PATH):
        print("[YControl] Keine Konfiguration gefunden: " + CONFIG_PATH, file=sys.stderr)
        sys.exit(1)

    with open(CONFIG_PATH) as f:
        cfg = json.load(f)

    # Periodische Re-Registrierung im Hintergrund (fuer Konflikt-Erkennung)
    threading.Thread(target=periodic_reregister, args=(CONFIG_PATH,), daemon=True).start()

    serial        = cfg["serialNumber"]
    server_url    = cfg.get("serverUrl", SERVER_URL)
    mqtt_host     = cfg.get("mqttHost", MQTT_HOST)
    mqtt_port     = cfg.get("mqttPort", MQTT_PORT)
    device_secret = cfg.get("deviceSecret", "")

    # Kein Secret vorhanden → erst registrieren/freigeben lassen
    if not device_secret:
        print("[YControl] Kein Device-Secret vorhanden – starte Registrierung...")
        while True:
            result, code = api_post(server_url + "/api/devices/register",
                                    {"serialNumber": serial, "piSerial": get_pi_serial()})
            if code in (200, 201):
                new_secret = result.get("deviceSecret")
                device_id  = result.get("deviceId")
                if new_secret:
                    cfg["deviceSecret"] = new_secret
                    if device_id:
                        cfg["deviceId"] = device_id
                    with open(CONFIG_PATH, "w") as f:
                        json.dump(cfg, f, indent=2)
                    device_secret = new_secret
                    print("[YControl] Registrierung erfolgreich – Secret erhalten.")
                    break
                else:
                    print("[YControl] Warte auf Freigabe durch Administrator...")
                    time.sleep(30)
                    # Token-Endpoint versuchen
                    resp2, code2 = api_post(server_url + "/api/devices/token", {"serialNumber": serial})
                    if code2 == 200 and "deviceSecret" in resp2:
                        cfg["deviceSecret"] = resp2["deviceSecret"]
                        if resp2.get("deviceId"):
                            cfg["deviceId"] = resp2["deviceId"]
                        with open(CONFIG_PATH, "w") as f:
                            json.dump(cfg, f, indent=2)
                        device_secret = resp2["deviceSecret"]
                        print("[YControl] Freigabe erhalten!")
                        break
            elif code == 409:
                print("[YControl] KONFLIKT – warte 2 min und versuche erneut...", file=sys.stderr)
                time.sleep(120)
            else:
                print("[YControl] Server nicht erreichbar (HTTP " + str(code) + ") – erneuter Versuch in 30s...")
                time.sleep(30)

    topic_stat = "yc/" + serial + "/stat"
    topic_tele = "yc/" + serial + "/tele"
    topic_cmnd = "yc/" + serial + "/cmnd"
    topic_resp = "yc/" + serial + "/resp"

    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        print("[YControl] paho-mqtt nicht installiert!", file=sys.stderr)
        sys.exit(1)

    TELE_INTERVAL = 600  # 10 Minuten
    auth_failed   = [False]

    def build_tele():
        tele = {"agentVersion": AGENT_VERSION, "ipAddress": get_local_ip()}
        tele["vpnActive"]  = get_vpn_status()
        tele["httpActive"] = get_http_status()
        for key, fn in [("anlageName",    get_anlage_name),
                        ("projectNumber", get_project_number),
                        ("schemaNumber",  get_schema_number),
                        ("visuVersion",   get_visu_version)]:
            val = fn()
            if val:
                tele[key] = val
        # Router-Info: LAN/WAN-IP und ob Router-Software installiert ist
        ri = get_router_info()
        tele["hasRouter"] = ri["hasRouter"]
        if ri["piLanIp"]:
            tele["piLanIp"] = ri["piLanIp"]
        if ri["piWanIp"]:
            tele["piWanIp"] = ri["piWanIp"]
        return tele

    def publish_tele(c):
        tele = build_tele()
        c.publish(topic_tele, json.dumps(tele), retain=True, qos=1)
        print("[YControl] Tele: " + str(tele))

    def make_client():
        try:
            c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=serial, protocol=mqtt.MQTTv311)
        except AttributeError:
            c = mqtt.Client(client_id=serial, protocol=mqtt.MQTTv311)
        c.username_pw_set(serial, cfg["deviceSecret"])
        c.will_set(topic_stat, "offline", retain=True, qos=1)
        c.on_connect    = on_connect
        c.on_disconnect = on_disconnect
        c.on_message    = on_message
        # Aggressives TCP-Keepalive: erkennt tote Sockets (z.B. nach DHCP-IP-Wechsel)
        # nach ~50s statt Linux-Default von ~11 Minuten.
        c.on_socket_open = _tcp_keepalive
        return c

    def _tcp_keepalive(c, userdata, sock):
        try:
            import socket as _sock
            sock.setsockopt(_sock.SOL_SOCKET, _sock.SO_KEEPALIVE, 1)
            if hasattr(_sock, "TCP_KEEPIDLE"):
                sock.setsockopt(_sock.IPPROTO_TCP, _sock.TCP_KEEPIDLE, 20)
            if hasattr(_sock, "TCP_KEEPINTVL"):
                sock.setsockopt(_sock.IPPROTO_TCP, _sock.TCP_KEEPINTVL, 10)
            if hasattr(_sock, "TCP_KEEPCNT"):
                sock.setsockopt(_sock.IPPROTO_TCP, _sock.TCP_KEEPCNT, 3)
        except Exception as ex:
            print("[YControl] TCP-Keepalive konnte nicht gesetzt werden: " + str(ex), file=sys.stderr)

    def on_connect(c, userdata, flags, rc):
        codes = {0:"OK",1:"Protokoll",2:"Client-ID",3:"Server",4:"Zugangsdaten",5:"Nicht autorisiert"}
        if rc == 0:
            auth_failed[0] = False
            print("[YControl] MQTT verbunden: " + mqtt_host + ":" + str(mqtt_port))
            c.publish(topic_stat, "online", retain=True, qos=1)
            publish_tele(c)
            c.subscribe(topic_cmnd, qos=1)
            print("[YControl] Agent bereit v" + AGENT_VERSION)
        else:
            print("[YControl] MQTT Fehler: " + codes.get(rc, str(rc)), file=sys.stderr)
            if rc in (4, 5):
                auth_failed[0] = True
                c.loop_stop()

    def on_disconnect(c, userdata, rc):
        if rc != 0:
            print("[YControl] MQTT getrennt (rc=" + str(rc) + "), verbinde neu...")

    def on_message(c, userdata, msg):
        try:
            cmd = json.loads(msg.payload.decode("utf-8"))
        except Exception:
            return
        print("[YControl] Befehl empfangen: " + str(cmd))
        action = cmd.get("action", "")
        if action == "refresh":
            publish_tele(c)
            c.publish(topic_resp, json.dumps({"action": "refresh", "status": "ok"}), qos=1)
        elif action == "restart":
            c.publish(topic_resp, json.dumps({"action": "restart", "status": "rebooting"}), qos=1)
            time.sleep(1)
            subprocess.Popen(["reboot"])
        elif action == "setName":
            new_name = cmd.get("value", "").strip()
            if new_name and set_anlage_name(new_name):
                c.publish(topic_tele, json.dumps({"agentVersion": AGENT_VERSION, "ipAddress": get_local_ip(), "anlageName": new_name}), retain=True, qos=1)
                c.publish(topic_resp, json.dumps({"action": "setName", "status": "ok"}), qos=1)
                print("[YControl] Anlagenname gesetzt: " + new_name)
            else:
                c.publish(topic_resp, json.dumps({"action": "setName", "status": "error"}), qos=1)
        elif action == "update":
            # Script wird direkt im MQTT-Befehl als Base64 mitgeliefert (kein HTTP nötig)
            script_b64 = cmd.get("script", "")
            if not script_b64:
                print("[YControl] Update fehlgeschlagen: kein Script im Befehl", file=sys.stderr)
                c.publish(topic_resp, json.dumps({"action": "update", "status": "error", "error": "kein Script"}), qos=1)
            else:
                print("[YControl] Update-Befehl empfangen – schreibe neues Script...")
                try:
                    import base64
                    new_script = base64.b64decode(script_b64)
                    tmp_path = AGENT_PATH + ".tmp"
                    with open(tmp_path, "wb") as f:
                        f.write(new_script)
                    os.chmod(tmp_path, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
                    os.replace(tmp_path, AGENT_PATH)
                    print("[YControl] Script aktualisiert – starte Service neu...")
                    c.publish(topic_resp, json.dumps({"action": "update", "status": "ok"}), qos=1)
                    time.sleep(1)
                    subprocess.Popen(["systemctl", "restart", "ycontrol-agent"])
                except Exception as ex:
                    print("[YControl] Update fehlgeschlagen: " + str(ex), file=sys.stderr)
                    c.publish(topic_resp, json.dumps({"action": "update", "status": "error", "error": str(ex)}), qos=1)
        elif action == "vpn_install":
            # WireGuard-Config wird direkt im MQTT-Befehl mitgeliefert (kein HTTP nötig)
            vpn_config = cmd.get("config", "")
            if not vpn_config:
                print("[YControl] VPN fehlgeschlagen: keine Config im Befehl", file=sys.stderr)
                c.publish(topic_resp, json.dumps({"action": "vpn_install", "status": "error", "error": "keine Config"}), qos=1)
            else:
                print("[YControl] VPN-Installation gestartet...")
                def do_vpn_install(c, vpn_config):
                    try:
                        # 1. WireGuard + iptables installieren
                        print("[YControl] Installiere WireGuard...")
                        subprocess.run(["apt-get", "update", "-qq"], check=True, capture_output=True)
                        subprocess.run(["apt-get", "install", "-y", "wireguard", "wireguard-tools", "iptables"], check=True)
                        # 2. Kernel-Module laden + IP-Forwarding aktivieren
                        subprocess.run(["modprobe", "wireguard"], capture_output=True)
                        subprocess.run(["modprobe", "xt_NETMAP"], capture_output=True)
                        with open("/proc/sys/net/ipv4/ip_forward", "w") as f:
                            f.write("1")
                        # persistieren (falls noch nicht gesetzt)
                        try:
                            sysctl_conf = "/etc/sysctl.conf"
                            content = open(sysctl_conf).read()
                            if "net.ipv4.ip_forward=1" not in content.replace(" ", ""):
                                with open(sysctl_conf, "a") as f:
                                    f.write("\\nnet.ipv4.ip_forward=1\\n")
                        except Exception:
                            pass
                        # 3. Konfiguration schreiben (aus MQTT-Payload)
                        print("[YControl] Schreibe VPN-Konfiguration...")
                        os.makedirs("/etc/wireguard", exist_ok=True)
                        wg_conf = "/etc/wireguard/wgyc.conf"
                        with open(wg_conf, "w") as f:
                            f.write(vpn_config)
                        os.chmod(wg_conf, 0o600)
                        print("[YControl] wgyc.conf geschrieben")
                        # 4. Altes wg0-Interface entfernen (Migration wg0→wgyc)
                        subprocess.run(["systemctl", "disable", "wg-quick@wg0"], capture_output=True)
                        subprocess.run(["wg-quick", "down", "wg0"], capture_output=True)
                        subprocess.run(["ip", "link", "delete", "wg0"], capture_output=True)
                        subprocess.run(["systemctl", "reset-failed", "wg-quick@wg0"], capture_output=True)
                        try:
                            os.remove("/etc/wireguard/wg0.conf")
                        except FileNotFoundError:
                            pass
                        # 5. Altes wgyc-Interface sauber entfernen (falls vorhanden)
                        subprocess.run(["wg-quick", "down", "wgyc"], capture_output=True)
                        subprocess.run(["ip", "link", "delete", "wgyc"], capture_output=True)
                        subprocess.run(["systemctl", "reset-failed", "wg-quick@wgyc"], capture_output=True)
                        # 6. wg-quick direkt starten – so sehen wir den exakten Fehler
                        test = subprocess.run(["wg-quick", "up", "wgyc"], capture_output=True, text=True)
                        if test.returncode != 0:
                            err_msg = (test.stdout + "\\n" + test.stderr).strip()
                            print("[YControl] wg-quick up Fehler:\\n" + err_msg, file=sys.stderr)
                            raise Exception(err_msg)
                        print("[YControl] wg-quick up OK – registriere als Service...")
                        subprocess.run(["systemctl", "enable", "wg-quick@wgyc"], capture_output=True)
                        print("[YControl] VPN aktiv!")
                        c.publish(topic_resp, json.dumps({"action": "vpn_install", "status": "ok"}), qos=1)
                    except Exception as ex:
                        print("[YControl] VPN-Installation fehlgeschlagen: " + str(ex), file=sys.stderr)
                        c.publish(topic_resp, json.dumps({"action": "vpn_install", "status": "error", "error": str(ex)}), qos=1)
                threading.Thread(target=do_vpn_install, args=(c, vpn_config), daemon=True).start()
        elif action == "vpn_remove":
            def do_vpn_remove(c):
                try:
                    print("[YControl] VPN-Deinstallation gestartet...")
                    subprocess.run(["systemctl", "disable", "wg-quick@wgyc"], capture_output=True)
                    subprocess.run(["wg-quick", "down", "wgyc"], capture_output=True)
                    subprocess.run(["ip", "link", "delete", "wgyc"], capture_output=True)
                    subprocess.run(["systemctl", "reset-failed", "wg-quick@wgyc"], capture_output=True)
                    # Config löschen
                    try:
                        os.remove("/etc/wireguard/wgyc.conf")
                    except FileNotFoundError:
                        pass
                    print("[YControl] VPN entfernt!")
                    c.publish(topic_resp, json.dumps({"action": "vpn_remove", "status": "ok"}), qos=1)
                except Exception as ex:
                    print("[YControl] VPN-Deinstallation fehlgeschlagen: " + str(ex), file=sys.stderr)
                    c.publish(topic_resp, json.dumps({"action": "vpn_remove", "status": "error", "error": str(ex)}), qos=1)
            threading.Thread(target=do_vpn_remove, args=(c,), daemon=True).start()

    running = [True]

    def shutdown(sig, frame):
        print("[YControl] Beende Agent...")
        running[0] = False
        try:
            client[0].publish(topic_stat, "offline", retain=True, qos=1)
            time.sleep(1)
            client[0].loop_stop()
            client[0].disconnect()
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT,  shutdown)

    client = [make_client()]

    while running[0]:
        auth_failed[0] = False
        client[0].connect_async(mqtt_host, mqtt_port, keepalive=30)
        client[0].loop_start()

        # Tele-Timer: alle 10 Minuten neu senden
        tele_tick = [0]
        last_ip = get_local_ip()
        ip_changed = [False]
        while running[0] and not auth_failed[0]:
            time.sleep(1)
            tele_tick[0] += 1

            # IP-Wechsel erkennen (z.B. neue DHCP-Lease) – alter Socket ist dann tot
            current_ip = get_local_ip()
            if current_ip and last_ip and current_ip != last_ip:
                print("[YControl] Lokale IP gewechselt: " + last_ip + " -> " + current_ip + " – reconnect MQTT")
                last_ip = current_ip
                ip_changed[0] = True
                break
            if current_ip and not last_ip:
                last_ip = current_ip

            if tele_tick[0] >= TELE_INTERVAL and client[0].is_connected():
                tele_tick[0] = 0
                publish_tele(client[0])

        client[0].loop_stop()

        if ip_changed[0] and running[0]:
            # Harter Reconnect: alten Client wegwerfen, neuen bauen
            try:
                client[0].disconnect()
            except Exception:
                pass
            client[0] = make_client()
            time.sleep(2)
            continue

        if not running[0]:
            break

        if auth_failed[0]:
            print("[YControl] Auth fehlgeschlagen – versuche Neuregistrierung...")
            attempt = 0
            while running[0]:
                attempt += 1
                result, code = api_post(server_url + "/api/devices/register",
                                        {"serialNumber": serial, "piSerial": get_pi_serial()})
                if code in (200, 201):
                    new_secret = result.get("deviceSecret")
                    if new_secret:
                        cfg["deviceSecret"] = new_secret
                        with open(CONFIG_PATH, "w") as f:
                            json.dump(cfg, f, indent=2)
                        print("[YControl] Neues Secret erhalten – verbinde MQTT neu...")
                        client[0] = make_client()
                        break
                    else:
                        print("[YControl] Versuch " + str(attempt) + ": Warte auf Freigabe durch Administrator...")
                        time.sleep(30)
                        # Auch /token versuchen (falls zwischenzeitlich freigegeben)
                        resp2, code2 = api_post(server_url + "/api/devices/token", {"serialNumber": serial})
                        if code2 == 200 and "deviceSecret" in resp2:
                            cfg["deviceSecret"] = resp2["deviceSecret"]
                            with open(CONFIG_PATH, "w") as f:
                                json.dump(cfg, f, indent=2)
                            print("[YControl] Freigabe erhalten – verbinde MQTT neu...")
                            client[0] = make_client()
                            break
                elif code == 409:
                    print("[YControl] KONFLIKT: YControl-Seriennummer ist bereits einem anderen Pi zugeordnet.", file=sys.stderr)
                    print("[YControl] Bitte Konflikt in der Cloud-UI aufloesen oder Seriennummer aendern.", file=sys.stderr)
                    time.sleep(120)
                else:
                    print("[YControl] Server nicht erreichbar (code=" + str(code) + ") – Versuch " + str(attempt) + " in 30s...")
                    time.sleep(30)

# ─── SETUP-MODUS ──────────────────────────────────────────────────────────────
def run_setup():
    if os.geteuid() != 0:
        print("[FEHLER] Bitte als root ausfuehren: sudo python3 ycontrol-setup.py")
        sys.exit(1)

    serial    = get_serial()
    pi_serial = get_pi_serial()
    print("[YControl] YControl-SN: " + serial)
    print("[YControl] Pi-Hardware: " + pi_serial)

    # Schritt 1: Registrieren (ein Versuch – der Agent-Service uebernimmt den Rest)
    device_secret = None
    device_id     = None
    reg_status    = "unknown"

    print("[YControl] Pruefe Verbindung zu: " + SERVER_URL)
    health_code = api_get(SERVER_URL + "/health")
    if health_code == 200:
        print("[YControl] Server erreichbar (HTTP 200)")
        print("[YControl] Registriere Geraet...")
        result, code = api_post(SERVER_URL + "/api/devices/register", {"serialNumber": serial, "piSerial": pi_serial})
        if code == 409:
            print("[YControl] KONFLIKT: Die YControl-Seriennummer '" + serial + "' ist bereits einem anderen Pi zugeordnet.", file=sys.stderr)
            print("[YControl] Bitte Konflikt in der Cloud-UI aufloesen oder eine andere Seriennummer verwenden.", file=sys.stderr)
            sys.exit(2)
        if code in (200, 201):
            reg_status    = result.get("status", "new")
            device_secret = result.get("deviceSecret")
            device_id     = result.get("deviceId")
            print("[YControl] Registrierung erfolgreich (Status: " + reg_status + ")")
        else:
            print("[YControl] Registrierung fehlgeschlagen (HTTP " + str(code) + ") – der Agent-Service wird es erneut versuchen.")
    else:
        if health_code == 0:
            print("[YControl] Server nicht erreichbar – der Agent-Service wird es spaeter versuchen.")
        else:
            print("[YControl] Server antwortet mit HTTP " + str(health_code) + " – der Agent-Service wird es spaeter versuchen.")

    # Schritt 2: Konfiguration speichern (auch ohne Secret – Agent holt es sich)
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    config = {
        "serialNumber": serial,
        "serverUrl":    SERVER_URL,
        "mqttHost":     MQTT_HOST,
        "mqttPort":     MQTT_PORT,
    }
    if device_id:
        config["deviceId"] = device_id
    if device_secret:
        config["deviceSecret"] = device_secret
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    os.chmod(CONFIG_PATH, 0o600)
    print("[YControl] Konfiguration gespeichert: " + CONFIG_PATH)

    # Schritt 4: paho-mqtt + websocket-client installieren
    for pkg, apt_pkg in [("paho-mqtt", "python3-paho-mqtt"), ("websocket-client", "python3-websocket")]:
        print("[YControl] Installiere " + pkg + "...")
        installed = False
        for cmd in [
            ["apt-get", "install", "-y", "-q", apt_pkg],
            [sys.executable, "-m", "pip", "install", "--quiet", "--break-system-packages", pkg],
            [sys.executable, "-m", "pip", "install", "--quiet", pkg],
        ]:
            if subprocess.run(cmd, capture_output=True).returncode == 0:
                print("[YControl] " + pkg + " installiert via: " + cmd[0])
                installed = True
                break
        if not installed:
            print("[WARNUNG] " + pkg + " konnte nicht installiert werden!")

    # Schritt 5: Agent-Script installieren
    shutil.copy2(os.path.abspath(__file__), AGENT_PATH)
    os.chmod(AGENT_PATH, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
    print("[YControl] Agent installiert: " + AGENT_PATH)

    # Schritt 6: systemd-Service
    service = """[Unit]
Description=YControl Cloud Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PYTHONUNBUFFERED=1
ExecStart=""" + sys.executable + """ -u """ + AGENT_PATH + """ --agent
Restart=on-failure
RestartSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"""
    with open(SERVICE_PATH, "w") as f:
        f.write(service)

    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "ycontrol-agent"], check=True)
    subprocess.run(["systemctl", "restart", "ycontrol-agent"], check=True)
    print("[YControl] Service gestartet!")

    print()
    print("  ✓ Einrichtung abgeschlossen!")
    print("  Server:    " + SERVER_URL)
    print("  MQTT:      " + MQTT_HOST + ":" + str(MQTT_PORT))
    if device_id:
        print("  Geraet-ID: " + str(device_id))
    print()
    if device_secret:
        print("  Status: Freigegeben – Agent verbindet sich automatisch.")
    else:
        print("  Status: Warte auf Freigabe in der Cloud-UI.")
        print("  Der Agent-Service laeuft im Hintergrund und verbindet sich")
        print("  automatisch, sobald das Geraet freigegeben wird.")
        print("  (SSH-Verbindung kann geschlossen werden)")
    print()
    print("  Logs:   journalctl -u ycontrol-agent -f")
    print("  Status: systemctl status ycontrol-agent")
    print()

# ─── Einstiegspunkt ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    if "--agent" in sys.argv:
        run_agent()
    else:
        run_setup()
`

// ─── Pi Registration Endpoints ────────────────────────────────────────────────

// POST /api/devices/register  (Raspberry Pi → erstmalige oder erneute Registrierung)
router.post('/register', async (req, res) => {
  const parsed = z.object({
    serialNumber: z.string().min(1).max(100),
    piSerial: z.string().optional(),
  }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Seriennummer erforderlich' }); return }

  const { serialNumber, piSerial } = parsed.data

  // 1. Lookup nach piSerial (Hardware-ID hat Vorrang) — nur Nicht-Konflikt-Records
  if (piSerial) {
    const byPi = await prisma.device.findFirst({
      where: { piSerial, hasConflict: false },
    })
    if (byPi) {
      // Pi ist bereits unter dieser Hardware-ID registriert
      // Wenn die YControl-SN sich geändert hat, aktualisieren (User hat /etc/ycontrol.json geändert)
      if (byPi.serialNumber !== serialNumber) {
        // Prüfen ob die neue SN bereits anderweitig vergeben ist
        const snTaken = await prisma.device.findUnique({ where: { serialNumber } })
        if (snTaken && snTaken.id !== byPi.id) {
          // Neue SN ist bereits vergeben → Konflikt anlegen statt umzubenennen
          console.log(`[Register] SN-Wechsel-Konflikt: pi=${piSerial}, alteSN=${byPi.serialNumber}, neueSN=${serialNumber} bereits vergeben`)
          const conflictSn = `CONFLICT-${piSerial}-${Date.now()}`
          const conflict = await prisma.device.create({
            data: {
              name: `${serialNumber} (KONFLIKT)`,
              serialNumber: conflictSn,
              requestedSerialNumber: serialNumber,
              hasConflict: true,
              piSerial,
            },
          })
          res.status(409).json({ deviceId: conflict.id, isApproved: false, status: 'conflict' })
          return
        }
        console.log(`[Register] SN-Wechsel: pi=${piSerial}, alt=${byPi.serialNumber}, neu=${serialNumber}`)
        await prisma.device.update({
          where: { id: byPi.id },
          data: { serialNumber, name: byPi.name === byPi.serialNumber ? serialNumber : byPi.name },
        })
      }
      if (byPi.isApproved) {
        const { secret, hash } = generateDeviceSecret()
        await prisma.device.update({ where: { id: byPi.id }, data: { deviceSecret: hash } })
        res.json({ deviceId: byPi.id, isApproved: true, status: 'existing_approved', deviceSecret: secret })
      } else {
        res.json({ deviceId: byPi.id, isApproved: false, status: 'existing' })
      }
      return
    }
  }

  // 2. Lookup nach serialNumber (alte Logik / Fallback wenn kein piSerial gesendet wurde)
  const existing = await prisma.device.findUnique({ where: { serialNumber } })

  if (existing && !existing.hasConflict) {
    // Pi sendet keinen piSerial → bestehenden Record verwenden (Legacy)
    if (!piSerial) {
      if (existing.isApproved) {
        const { secret, hash } = generateDeviceSecret()
        await prisma.device.update({ where: { id: existing.id }, data: { deviceSecret: hash } })
        res.json({ deviceId: existing.id, isApproved: true, status: 'existing_approved', deviceSecret: secret })
      } else {
        res.json({ deviceId: existing.id, isApproved: false, status: 'existing' })
      }
      return
    }

    // Pi sendet piSerial → bestehender Record hat noch keinen → erstmals zuordnen
    if (!existing.piSerial) {
      console.log(`[Register] piSerial erstmals zugeordnet: SN=${serialNumber}, pi=${piSerial}`)
      await prisma.device.update({ where: { id: existing.id }, data: { piSerial } })
      if (existing.isApproved) {
        const { secret, hash } = generateDeviceSecret()
        await prisma.device.update({ where: { id: existing.id }, data: { deviceSecret: hash } })
        res.json({ deviceId: existing.id, isApproved: true, status: 'existing_approved', deviceSecret: secret })
      } else {
        res.json({ deviceId: existing.id, isApproved: false, status: 'existing' })
      }
      return
    }

    // KONFLIKT: SN ist bereits einem anderen piSerial zugeordnet
    console.log(`[Register] KONFLIKT: SN="${serialNumber}" gehört bereits zu pi=${existing.piSerial}, neuer pi=${piSerial}`)
    const conflictSn = `CONFLICT-${piSerial}-${Date.now()}`
    const conflict = await prisma.device.create({
      data: {
        name: `${serialNumber} (KONFLIKT)`,
        serialNumber: conflictSn,
        requestedSerialNumber: serialNumber,
        hasConflict: true,
        piSerial,
      },
    })
    res.status(409).json({ deviceId: conflict.id, isApproved: false, status: 'conflict' })
    return
  }

  // 3. Neues Gerät anlegen
  const device = await prisma.device.create({
    data: { name: serialNumber, serialNumber, piSerial: piSerial ?? null },
  })
  res.status(201).json({ deviceId: device.id, isApproved: false, status: 'created' })
})

// POST /api/devices/token  (Pi wartet auf Freigabe → holt deviceSecret)
router.post('/token', async (req, res) => {
  const parsed = z.object({ serialNumber: z.string().min(1) }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Seriennummer erforderlich' }); return }

  const device = await prisma.device.findUnique({ where: { serialNumber: parsed.data.serialNumber } })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (!device.isApproved) { res.status(403).json({ message: 'Gerät nicht freigegeben' }); return }

  // Generiere neues Secret bei jeder Abholung
  const { secret, hash } = generateDeviceSecret()
  await prisma.device.update({ where: { id: device.id }, data: { deviceSecret: hash } })
  res.json({ deviceSecret: secret, deviceId: device.id })
})

// POST /api/devices/mqtt-auth  (Mosquitto go-auth HTTP-Backend)
// Mosquitto erwartet: HTTP 200 = allow, HTTP 4xx = deny
router.post('/mqtt-auth', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string }

  if (!username || !password) {
    res.status(403).end(); return
  }

  // Backend-Client (interner Subscriber)
  if (username === env.mqttBackendUser && password === env.mqttBackendPassword) {
    console.log('[MQTT-Auth] ALLOW – backend-client')
    res.status(200).end(); return
  }

  // Pi-Gerät: username = serialNumber, password = deviceSecret (Plaintext)
  const device = await prisma.device.findUnique({
    where: { serialNumber: username },
    select: { id: true, isApproved: true, deviceSecret: true, serialNumber: true, hasConflict: true },
  })

  if (!device) {
    console.warn(`[MQTT-Auth] DENY – Gerät nicht gefunden: "${username}"`)
    res.status(403).end(); return
  }
  if (device.hasConflict) {
    console.warn(`[MQTT-Auth] DENY – Konflikt-Record: "${username}"`)
    res.status(403).end(); return
  }
  if (!device.isApproved) {
    console.warn(`[MQTT-Auth] DENY – Nicht freigegeben: "${username}"`)
    res.status(403).end(); return
  }
  if (!device.deviceSecret) {
    console.warn(`[MQTT-Auth] DENY – Kein Secret in DB: "${username}"`)
    res.status(403).end(); return
  }

  const inputHash = hashDeviceSecret(password)
  if (inputHash !== device.deviceSecret) {
    console.warn(`[MQTT-Auth] DENY – Falsches Secret: "${username}"`)
    res.status(403).end(); return
  }

  console.log(`[MQTT-Auth] ALLOW – "${username}"`)
  res.status(200).end()
})

// POST /api/devices/mqtt-acl  (Mosquitto go-auth ACL – alle erlauben wenn authentifiziert)
router.post('/mqtt-acl', (req, res) => {
  res.status(200).end()
})

// GET /api/devices/setup-script
router.get('/setup-script', authenticate, requirePermission('devices:read'), async (req, res) => {
  const [serverUrl, mqttHost, mqttPort] = await Promise.all([
    getSetting('pi.serverUrl'),
    getSetting('pi.mqttHost'),
    getSetting('pi.mqttPort'),
  ])
  const script = SETUP_SCRIPT_TEMPLATE
    .replace('<<SERVER_URL>>', serverUrl)
    .replace('<<MQTT_HOST>>', mqttHost)
    .replace('<<MQTT_PORT>>', mqttPort)
    .replace('<<GENERATED_AT>>', new Date().toISOString())

  res.setHeader('Content-Type', 'text/x-python')
  res.setHeader('Content-Disposition', 'attachment; filename="ycontrol-setup.py"')
  res.send(script)
})

// GET /api/devices/agent-update  (Pi → lädt neues Agent-Script herunter, Device-Auth via Header)
router.get('/agent-update', async (req, res) => {
  const serial = req.headers['x-device-serial'] as string | undefined
  const secret = req.headers['x-device-secret'] as string | undefined

  if (!serial || !secret) { res.status(401).json({ message: 'Authentifizierung erforderlich' }); return }

  const device = await prisma.device.findUnique({
    where: { serialNumber: serial },
    select: { id: true, isApproved: true, deviceSecret: true },
  })
  if (!device?.isApproved || !device.deviceSecret) { res.status(403).json({ message: 'Nicht autorisiert' }); return }
  if (hashDeviceSecret(secret) !== device.deviceSecret) { res.status(403).json({ message: 'Nicht autorisiert' }); return }

  const [serverUrl, mqttHost, mqttPort] = await Promise.all([
    getSetting('pi.serverUrl'),
    getSetting('pi.mqttHost'),
    getSetting('pi.mqttPort'),
  ])
  const script = SETUP_SCRIPT_TEMPLATE
    .replace('<<SERVER_URL>>', serverUrl)
    .replace('<<MQTT_HOST>>', mqttHost)
    .replace('<<MQTT_PORT>>', mqttPort)
    .replace('<<GENERATED_AT>>', new Date().toISOString())

  res.setHeader('Content-Type', 'text/x-python')
  res.send(script)
})

// ─── Device CRUD ──────────────────────────────────────────────────────────────

// GET /api/devices
router.get('/', authenticate, requirePermission('devices:read'), async (req, res) => {
  const accessWhere = buildVisibleDevicesWhere(req.user!)
  // LAN-Geräte (parentDeviceId gesetzt) nur unter ihrem Haupt-Gerät anzeigen, nicht in der Hauptliste
  const where = { AND: [accessWhere, { parentDeviceId: null }] }
  const devices = await prisma.device.findMany({ where, include: deviceInclude, orderBy: { name: 'asc' } })
  res.json(devices.map((d) => ({
    ...d,
    mqttConnected: d.status === 'ONLINE',
    isApproved: d.isApproved,
    lastSeen: d.lastSeen,
  })))
})

// GET /api/devices/:id
router.get('/:id', authenticate, requirePermission('devices:read'), async (req, res) => {
  const where = buildVisibleDevicesWhere(req.user!)
  const device = await prisma.device.findFirst({
    where: { id: req.params.id as string, ...where },
    include: {
      ...deviceInclude,
      todos: { include: { createdBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
      logEntries: { include: { createdBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
    },
  })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  res.json({ ...device, mqttConnected: device.status === 'ONLINE' })
})

// POST /api/devices
router.post('/', authenticate, requirePermission('devices:create'), async (req, res) => {
  const parsed = deviceSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { anlageIds, userIds, groupIds, ...data } = parsed.data
  const device = await prisma.device.create({
    data: {
      ...data,
      anlageDevices: anlageIds ? { create: anlageIds.map((anlageId) => ({ anlageId })) } : undefined,
      directUsers: userIds ? { create: userIds.map((userId) => ({ userId })) } : undefined,
      directGroups: groupIds ? { create: groupIds.map((groupId) => ({ groupId })) } : undefined,
    },
    include: deviceInclude,
  })
  res.status(201).json(device)
})

// PATCH /api/devices/:id
router.patch('/:id', authenticate, requirePermission('devices:update'), async (req, res) => {
  const parsed = deviceSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { anlageIds, userIds, groupIds, ...data } = parsed.data
  const device = await prisma.device.update({
    where: { id: req.params.id as string },
    data: {
      ...data,
      ...(anlageIds !== undefined && {
        anlageDevices: { deleteMany: {}, create: anlageIds.map((anlageId) => ({ anlageId })) },
      }),
      ...(userIds !== undefined && {
        directUsers: { deleteMany: {}, create: userIds.map((userId) => ({ userId })) },
      }),
      ...(groupIds !== undefined && {
        directGroups: { deleteMany: {}, create: groupIds.map((groupId) => ({ groupId })) },
      }),
    },
    include: deviceInclude,
  })

  // Name geändert → an Pi zurückschreiben (Pi schreibt in SQLite DB)
  if (parsed.data.name && device.status === 'ONLINE') {
    publishCommand(device.serialNumber, { action: 'setName', value: parsed.data.name })
  }

  res.json(device)
})

// DELETE /api/devices/:id
router.delete('/:id', authenticate, requirePermission('devices:delete'), async (req, res) => {
  const device = await prisma.device.findUnique({
    where: { id: req.params.id as string },
    select: { serialNumber: true },
  })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }

  await prisma.device.delete({ where: { id: req.params.id as string } })

  // MQTT aufräumen: Client trennen + Retained Messages löschen
  void kickMqttClient(device.serialNumber)
  void clearRetainedMessages(device.serialNumber)

  res.status(204).send()
})

// PATCH /api/devices/:id/approve
router.patch('/:id/approve', authenticate, requirePermission('devices:update'), async (req, res) => {
  const parsed = z.object({ isApproved: z.boolean() }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  const device = await prisma.device.update({
    where: { id: req.params.id as string },
    data: {
      isApproved: parsed.data.isApproved,
      // Freigabe entzogen: Secret löschen damit altes Secret nicht mehr gilt
      ...(parsed.data.isApproved === false && { deviceSecret: null }),
    },
    include: deviceInclude,
  })

  // Freigabe entzogen → MQTT-Client sofort trennen
  if (!parsed.data.isApproved) {
    void kickMqttClient(device.serialNumber)
  }

  res.json(device)
})

// POST /api/devices/:id/command  (Frontend → sendet Befehl an Pi via MQTT)
router.post('/:id/command', authenticate, requirePermission('devices:update'), async (req, res) => {
  const parsed = z.object({ action: z.string().min(1) }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  const device = await prisma.device.findUnique({
    where: { id: req.params.id as string },
    select: { id: true, serialNumber: true, status: true },
  })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (device.status !== 'ONLINE') { res.status(409).json({ message: 'Gerät ist offline' }); return }

  // Update: Script direkt via MQTT übermitteln (kein HTTP-Pull durch den Pi)
  if (parsed.data.action === 'update') {
    const [serverUrl, mqttHost, mqttPort] = await Promise.all([
      getSetting('pi.serverUrl'),
      getSetting('pi.mqttHost'),
      getSetting('pi.mqttPort'),
    ])
    const script = SETUP_SCRIPT_TEMPLATE
      .replace('<<SERVER_URL>>', serverUrl)
      .replace('<<MQTT_HOST>>', mqttHost)
      .replace('<<MQTT_PORT>>', mqttPort)
      .replace('<<GENERATED_AT>>', new Date().toISOString())
    const scriptB64 = Buffer.from(script).toString('base64')
    const sent = publishCommand(device.serialNumber, { action: 'update', script: scriptB64 })
    if (!sent) { res.status(503).json({ message: 'MQTT nicht verfügbar' }); return }
    res.json({ ok: true, serial: device.serialNumber, command: { action: 'update' } })
    return
  }

  const sent = publishCommand(device.serialNumber, req.body)
  if (!sent) { res.status(503).json({ message: 'MQTT nicht verfügbar' }); return }

  res.json({ ok: true, serial: device.serialNumber, command: req.body })
})

// ─── Todos & Logs ─────────────────────────────────────────────────────────────

// POST /api/devices/:id/todos
router.post('/:id/todos', authenticate, requirePermission('todos:create'), async (req, res) => {
  const parsed = todoSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }
  const [todo] = await prisma.$transaction([
    prisma.deviceTodo.create({
      data: { deviceId: req.params.id as string, ...parsed.data, createdById: req.user!.userId },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.deviceLogEntry.create({
      data: {
        deviceId: req.params.id as string,
        message: `Todo erstellt: "${parsed.data.title}"`,
        createdById: req.user!.userId,
      },
    }),
  ])
  res.status(201).json(todo)
})

// PATCH /api/devices/:id/todos/:todoId
router.patch('/:id/todos/:todoId', authenticate, requirePermission('todos:update'), async (req, res) => {
  const parsed = todoUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }
  const existing = await prisma.deviceTodo.findUnique({ where: { id: req.params.todoId as string }, select: { title: true } })
  const logMessage = parsed.data.status === 'DONE'
    ? `Todo abgehakt: "${existing?.title}"`
    : `Todo wieder geöffnet: "${existing?.title}"`
  const [todo] = await prisma.$transaction([
    prisma.deviceTodo.update({
      where: { id: req.params.todoId as string, deviceId: req.params.id as string },
      data: parsed.data,
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.deviceLogEntry.create({
      data: { deviceId: req.params.id as string, message: logMessage, createdById: req.user!.userId },
    }),
  ])
  res.json(todo)
})

// POST /api/devices/:id/logs
router.post('/:id/logs', authenticate, requirePermission('logbook:create'), async (req, res) => {
  const parsed = logSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }
  const log = await prisma.deviceLogEntry.create({
    data: { deviceId: req.params.id as string, ...parsed.data, createdById: req.user!.userId },
    include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
  })
  res.status(201).json(log)
})

// ─── LAN-Geräte (Nicht-Visu-Geräte im Pi-LAN) ──────────────────────────────

const lanDeviceSchema = z.object({
  name:        z.string().min(1).max(200),
  lanTargetIp: z.string().min(7).max(45),
  lanTargetPort: z.number().int().min(1).max(65535).optional().default(80),
  notes:       z.string().optional(),
})

// POST /api/devices/:id/lan-devices  – LAN-Gerät unter einem Pi-Gerät anlegen
router.post('/:id/lan-devices', authenticate, requirePermission('devices:create'), async (req, res) => {
  const parentId = req.params.id as string
  const parsed = lanDeviceSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  // Prüfe ob übergeordnetes Gerät existiert und VPN hat
  const parent = await prisma.device.findUnique({
    where: { id: parentId },
    include: { vpnDevice: { select: { id: true } } },
  })
  if (!parent) { res.status(404).json({ message: 'Übergeordnetes Gerät nicht gefunden' }); return }
  if (!parent.vpnDevice) { res.status(409).json({ message: 'Übergeordnetes Gerät hat kein VPN' }); return }

  // Serial auto-generieren
  const serial = `LAN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  const device = await prisma.device.create({
    data: {
      name: parsed.data.name,
      serialNumber: serial,
      parentDeviceId: parentId,
      lanTargetIp: parsed.data.lanTargetIp,
      lanTargetPort: parsed.data.lanTargetPort,
      notes: parsed.data.notes ?? null,
      status: 'UNKNOWN',
      // LAN-Geräte erben die Anlagen-Zuweisungen des übergeordneten Geräts
    },
    include: deviceInclude,
  })
  res.status(201).json(device)
})

// PUT /api/devices/:id/lan-device  – LAN-Gerät bearbeiten (nur für LAN-Geräte)
router.put('/:id/lan-device', authenticate, requirePermission('devices:update'), async (req, res) => {
  const parsed = lanDeviceSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  const existing = await prisma.device.findUnique({ where: { id: req.params.id as string } })
  if (!existing) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (!existing.parentDeviceId) { res.status(409).json({ message: 'Kein LAN-Gerät' }); return }

  const device = await prisma.device.update({
    where: { id: req.params.id as string },
    data: {
      name: parsed.data.name,
      lanTargetIp: parsed.data.lanTargetIp,
      lanTargetPort: parsed.data.lanTargetPort,
      notes: parsed.data.notes,
    },
    include: deviceInclude,
  })
  res.json(device)
})

export default router

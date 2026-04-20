import dotenv from 'dotenv'
dotenv.config()

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env variable: ${key}`)
  return val
}

export const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL'),
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  mqttAuthSecret: process.env.MQTT_AUTH_SECRET ?? 'dev-mqtt-internal-secret',
  mqttBackendUser: process.env.MQTT_BACKEND_USER ?? 'backend-client',
  mqttBackendPassword: process.env.MQTT_BACKEND_PASSWORD ?? 'backend-dev-secret',
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  vpn: {
    serverPrivateKey: process.env.VPN_SERVER_PRIVATE_KEY ?? '',
    wgContainer:      process.env.VPN_WG_CONTAINER      ?? 'ycontrol_wireguard',
    wgConfigPath:     process.env.VPN_WG_CONFIG_PATH    ?? '/wireguard-config/wg0.conf',
  },
  smtp: {
    host:     process.env.SMTP_HOST     ?? '',
    port:     parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure:   process.env.SMTP_SECURE   === 'true',
    user:     process.env.SMTP_USER     ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from:     process.env.SMTP_FROM     ?? 'YControl Cloud <noreply@ycontrol.local>',
  },
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
}

/**
 * Startup-Sicherheits-Check: verweigert den Start im Production-Modus wenn
 * bekannte Dev-Defaults aktiv sind. Das verhindert versehentliches Deployment
 * mit öffentlich bekannten Secrets.
 */
export function validateProdSecrets(): void {
  if (env.nodeEnv !== 'production') return

  const problems: string[] = []
  const DEV_MARKERS = ['change-me', 'dev-', 'CHANGE_ME', 'your-', 'secret-here']

  const checks: Array<[string, string]> = [
    ['JWT_ACCESS_SECRET', env.jwt.accessSecret],
    ['JWT_REFRESH_SECRET', env.jwt.refreshSecret],
    ['MQTT_AUTH_SECRET', env.mqttAuthSecret],
    ['MQTT_BACKEND_PASSWORD', env.mqttBackendPassword],
  ]
  for (const [name, value] of checks) {
    if (!value || value.length < 24) {
      problems.push(`${name}: zu kurz (min 24 Zeichen erforderlich, aktuell ${value.length})`)
    } else if (DEV_MARKERS.some((m) => value.toLowerCase().includes(m.toLowerCase()))) {
      problems.push(`${name}: enthält Dev-Platzhalter. Muss in Prod ein starkes, zufälliges Secret sein.`)
    }
  }

  if (env.jwt.accessSecret === env.jwt.refreshSecret) {
    problems.push('JWT_ACCESS_SECRET und JWT_REFRESH_SECRET dürfen nicht identisch sein')
  }

  if (problems.length > 0) {
    console.error('═══════════════════════════════════════════════════════════════')
    console.error('  🚨 SECURITY: Produktions-Start abgebrochen')
    console.error('═══════════════════════════════════════════════════════════════')
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error('')
    console.error('  Bitte in der .env sichere, zufällige Secrets setzen, z.B.:')
    console.error('  JWT_ACCESS_SECRET=$(openssl rand -hex 32)')
    console.error('  JWT_REFRESH_SECRET=$(openssl rand -hex 32)')
    console.error('═══════════════════════════════════════════════════════════════')
    process.exit(1)
  }
}

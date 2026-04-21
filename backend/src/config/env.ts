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
  deepl: {
    /** API-Key (optional). Ohne Key wird das Wiki nicht automatisch übersetzt. */
    apiKey: process.env.DEEPL_API_KEY ?? '',
    /** 'free' (api-free.deepl.com) oder 'pro' (api.deepl.com) */
    tier: (process.env.DEEPL_TIER ?? 'free') as 'free' | 'pro',
  },
}

/**
 * Startup-Sicherheits-Check: verweigert den Start im Production-Modus wenn
 * bekannte Dev-Defaults aktiv sind. Das verhindert versehentliches Deployment
 * mit öffentlich bekannten Secrets.
 */
type SecretIssue = 'too_short' | 'dev_placeholder' | 'identical'

/** Klassifiziert ein Secret OHNE es selbst weiterzureichen. */
function classifySecret(value: string | undefined): SecretIssue | null {
  if (!value || value.length < 24) return 'too_short'
  const DEV_MARKERS = ['change-me', 'dev-', 'change_me', 'your-', 'secret-here']
  const lower = value.toLowerCase()
  if (DEV_MARKERS.some((m) => lower.includes(m))) return 'dev_placeholder'
  return null
}

/** Renderbare, NICHT-sensible Beschreibung eines Issues. */
function describeIssue(name: string, issue: SecretIssue): string {
  switch (issue) {
    case 'too_short':       return `${name}: zu kurz (min 24 Zeichen erforderlich)`
    case 'dev_placeholder': return `${name}: enthält Dev-Platzhalter. Muss in Prod ein starkes, zufälliges Secret sein.`
    case 'identical':       return 'JWT_ACCESS_SECRET und JWT_REFRESH_SECRET dürfen nicht identisch sein'
  }
}

export function validateProdSecrets(): void {
  if (env.nodeEnv !== 'production') return

  // Tupel (name, issue) – Werte fließen NICHT in den Log-Output.
  const issues: Array<[string, SecretIssue]> = []

  const checks: Array<[string, string]> = [
    ['JWT_ACCESS_SECRET', env.jwt.accessSecret],
    ['JWT_REFRESH_SECRET', env.jwt.refreshSecret],
    ['MQTT_AUTH_SECRET', env.mqttAuthSecret],
    ['MQTT_BACKEND_PASSWORD', env.mqttBackendPassword],
  ]
  for (const [name, value] of checks) {
    const issue = classifySecret(value)
    if (issue) issues.push([name, issue])
  }

  if (env.jwt.accessSecret === env.jwt.refreshSecret) {
    issues.push(['JWT_*_SECRET', 'identical'])
  }

  if (issues.length > 0) {
    console.error('═══════════════════════════════════════════════════════════════')
    console.error('  🚨 SECURITY: Produktions-Start abgebrochen')
    console.error('═══════════════════════════════════════════════════════════════')
    for (const [name, issue] of issues) {
      console.error('  ✗ %s', describeIssue(name, issue))
    }
    console.error('')
    console.error('  Bitte in der .env sichere, zufällige Secrets setzen, z.B.:')
    console.error('  JWT_ACCESS_SECRET=$(openssl rand -hex 32)')
    console.error('  JWT_REFRESH_SECRET=$(openssl rand -hex 32)')
    console.error('═══════════════════════════════════════════════════════════════')
    process.exit(1)
  }
}

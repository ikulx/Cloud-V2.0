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

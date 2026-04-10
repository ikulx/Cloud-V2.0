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
}

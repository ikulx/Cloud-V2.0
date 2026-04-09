import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

interface TokenPayload {
  sub: string
  email: string
}

export function issueAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn as jwt.SignOptions['expiresIn'],
  })
}

export function issueRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn as jwt.SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.jwt.accessSecret) as TokenPayload
  } catch {
    return null
  }
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.jwt.refreshSecret) as TokenPayload
  } catch {
    return null
  }
}

export function generateDeviceSecret(): { secret: string; hash: string } {
  const secret = crypto.randomBytes(32).toString('hex')
  const hash = crypto.createHash('sha256').update(secret).digest('hex')
  return { secret, hash }
}

export function hashDeviceSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex')
}

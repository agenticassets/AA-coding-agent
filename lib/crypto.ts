import crypto from 'crypto'

const ALGORITHM_GCM = 'aes-256-gcm'
const ALGORITHM_CBC = 'aes-256-cbc'
const IV_LENGTH_GCM = 12
const IV_LENGTH_CBC = 16
const TAG_LENGTH = 16

const getEncryptionKey = (): Buffer | null => {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    return null
  }
  const keyBuffer = Buffer.from(key, 'hex')
  if (keyBuffer.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be a 32-byte hex string (64 characters). Generate one with: openssl rand -hex 32',
    )
  }
  return keyBuffer
}

export const encrypt = (text: string): string => {
  if (!text) return text

  const ENCRYPTION_KEY = getEncryptionKey()
  if (!ENCRYPTION_KEY) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required for MCP encryption. Generate one with: openssl rand -hex 32',
    )
  }

  const iv = crypto.randomBytes(IV_LENGTH_GCM)
  const cipher = crypto.createCipheriv(ALGORITHM_GCM, ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`
}

export const decrypt = (encryptedText: string): string | null => {
  if (!encryptedText) return null

  const ENCRYPTION_KEY = getEncryptionKey()
  if (!ENCRYPTION_KEY) {
    console.error('Decryption service unavailable')
    return null
  }

  if (!encryptedText.includes(':')) {
    console.error('Invalid encrypted format detected')
    return null
  }

  try {
    const parts = encryptedText.split(':')

    if (parts.length === 3) {
      // GCM format: iv:encrypted:tag (new format)
      const [ivHex, encryptedHex, tagHex] = parts
      const iv = Buffer.from(ivHex, 'hex')
      const encrypted = Buffer.from(encryptedHex, 'hex')
      const tag = Buffer.from(tagHex, 'hex')

      const decipher = crypto.createDecipheriv(ALGORITHM_GCM, ENCRYPTION_KEY, iv)
      decipher.setAuthTag(tag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

      return decrypted.toString('utf8')
    } else if (parts.length === 2) {
      // CBC format: iv:encrypted (legacy format for backward compatibility)
      const [ivHex, encryptedHex] = parts
      const iv = Buffer.from(ivHex, 'hex')
      const encrypted = Buffer.from(encryptedHex, 'hex')

      const decipher = crypto.createDecipheriv(ALGORITHM_CBC, ENCRYPTION_KEY, iv)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

      return decrypted.toString('utf8')
    } else {
      console.error('Invalid encrypted format detected')
      return null
    }
  } catch {
    console.error('Decryption failed')
    return null
  }
}

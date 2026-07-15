import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

// Envelope encryption for secrets at rest (OAuth access/refresh tokens, etc).
// Defense-in-depth: if the database is exfiltrated, stored tokens are ciphertext,
// not directly usable against the provider APIs.
//
// ENCRYPTION_KEY must be a 32-byte key, hex-encoded (64 hex characters).
// Generate one with: openssl rand -hex 32
const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH_BYTES = 32
const IV_LENGTH_BYTES = 12 // recommended nonce size for GCM

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const hex = process.env.ENCRYPTION_KEY
  if (!hex) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and set it in your environment."
    )
  }
  const key = Buffer.from(hex, "hex")
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must be a ${KEY_LENGTH_BYTES}-byte hex string (${KEY_LENGTH_BYTES * 2} hex characters).`
    )
  }
  cachedKey = key
  return key
}

// Encrypts `plaintext`, returning "iv:authTag:ciphertext" (all hex-encoded).
// A fresh random IV is generated per call so identical plaintexts produce
// different ciphertexts.
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`
}

// Decrypts a value produced by `encrypt`. Throws if the payload is malformed,
// the key is wrong, or the ciphertext was tampered with (GCM auth-tag check).
export function decrypt(payload: string): string {
  const key = getKey()
  const parts = payload.split(":")
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format, expected 'iv:authTag:ciphertext'")
  }
  const [ivHex, authTagHex, ciphertextHex] = parts
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ])
  return plaintext.toString("utf8")
}

// Nullable convenience wrappers — OAuth token fields are frequently optional
// (a connection mid-setup, a provider that doesn't issue a refresh token).
export function encryptNullable(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null
  return encrypt(plaintext)
}

export function decryptNullable(payload: string | null | undefined): string | null {
  if (payload == null) return null
  return decrypt(payload)
}

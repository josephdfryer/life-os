import { createHash } from "node:crypto"
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider"
import { UPLOAD_URL_TTL_SECONDS } from "./types"

export type StoredObjectHead = {
  sizeBytes: number
  mimeType: string | null
  checksumSha256: string | null
  etag: string | null
}

export type PresignedUpload = {
  url: string
  method: "PUT"
  expiresIn: number
  headers: Record<string, string>
}

export interface FileStorage {
  readonly provider: "s3" | "local"
  createUpload(key: string, mimeType: string, checksumSha256Base64: string): Promise<PresignedUpload>
  createDownload(key: string, filename: string): Promise<{ url: string; expiresIn: number } | null>
  head(key: string): Promise<StoredObjectHead>
  read(key: string): Promise<Uint8Array>
  readPrefix(key: string, length?: number): Promise<Uint8Array>
  writeForTesting?(key: string, bytes: Uint8Array, mimeType: string): Promise<void>
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for S3 file storage`)
  return value
}

export class S3FileStorage implements FileStorage {
  readonly provider = "s3" as const
  readonly bucket: string
  readonly client: S3Client

  constructor() {
    const region = requireEnv("AWS_REGION")
    this.bucket = requireEnv("S3_BUCKET_NAME")
    this.client = new S3Client({
      region,
      credentials: awsCredentialsProvider({
        roleArn: requireEnv("AWS_ROLE_ARN"),
        clientConfig: { region },
      }),
    })
  }

  async createUpload(key: string, mimeType: string, checksumSha256Base64: string) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
      ChecksumSHA256: checksumSha256Base64,
      Metadata: { "life-os-sha256": checksumSha256Base64 },
      ServerSideEncryption: "AES256",
    })
    const url = await getSignedUrl(this.client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS })
    return {
      url,
      method: "PUT" as const,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      headers: uploadHeadersFor(url, mimeType, checksumSha256Base64),
    }
  }

  async createDownload(key: string, filename: string) {
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    const url = await getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket, Key: key, ResponseContentDisposition: disposition,
    }), { expiresIn: UPLOAD_URL_TTL_SECONDS })
    return { url, expiresIn: UPLOAD_URL_TTL_SECONDS }
  }

  async head(key: string): Promise<StoredObjectHead> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
    return {
      sizeBytes: result.ContentLength ?? -1,
      mimeType: result.ContentType ?? null,
      checksumSha256: result.ChecksumSHA256 ?? result.Metadata?.["life-os-sha256"] ?? null,
      etag: result.ETag?.replaceAll('"', "") ?? null,
    }
  }

  async read(key: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!result.Body) throw new Error("S3 object body was empty")
    return result.Body.transformToByteArray()
  }

  async readPrefix(key: string, length = 4096) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${Math.max(0, length - 1)}` }))
    if (!result.Body) throw new Error("S3 object body was empty")
    return result.Body.transformToByteArray()
  }
}

export class LocalFileStorage implements FileStorage {
  readonly provider = "local" as const
  constructor(readonly root = process.env.LIFE_OS_FILE_DIR ?? path.join(process.cwd(), ".life-os-files")) {}

  private resolved(key: string) {
    const resolved = path.resolve(this.root, key)
    const root = path.resolve(this.root) + path.sep
    if (!resolved.startsWith(root)) throw new Error("Invalid storage key")
    return resolved
  }

  async createUpload(): Promise<PresignedUpload> {
    throw new Error("Local storage uses the authenticated server upload route, not a presigned URL")
  }

  async createDownload() { return null }

  async head(key: string): Promise<StoredObjectHead> {
    const file = this.resolved(key)
    const [info, bytes] = await Promise.all([stat(file), readFile(file)])
    return {
      sizeBytes: info.size,
      mimeType: null,
      checksumSha256: createHash("sha256").update(bytes).digest("base64"),
      etag: null,
    }
  }

  async read(key: string) {
    return new Uint8Array(await readFile(this.resolved(key)))
  }

  async readPrefix(key: string, length = 4096) {
    const handle = await open(this.resolved(key), "r")
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, 0)
      return new Uint8Array(buffer.subarray(0, bytesRead))
    } finally { await handle.close() }
  }

  async writeForTesting(key: string, bytes: Uint8Array) {
    const file = this.resolved(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, bytes)
  }
}

export function getFileStorage(): FileStorage {
  if (process.env.FILE_STORAGE_PROVIDER === "local") return new LocalFileStorage()
  return new S3FileStorage()
}

// Which headers the browser may send with a presigned PUT is decided by the
// signature, not by us. SigV4 requires every `x-amz-*` header to be covered by
// the signature, so sending an uncovered one makes S3 reject the whole request
// with 403 — which is exactly what happened when this list was hand-written:
// the SDK hoists `x-amz-checksum-sha256` and `x-amz-meta-*` into query
// parameters and signs only `x-amz-server-side-encryption`, so re-sending the
// hoisted two as headers invalidated an otherwise correct upload.
//
// Deriving the set from X-Amz-SignedHeaders keeps this correct if a future SDK
// version changes what it hoists versus signs. Exported for the test that pins
// the invariant.
export function uploadHeadersFor(signedUrl: string, mimeType: string, checksumSha256Base64: string) {
  const signed = new Set(
    (new URL(signedUrl).searchParams.get("X-Amz-SignedHeaders") ?? "")
      .split(";")
      .map(name => name.trim().toLowerCase())
      .filter(name => name && name !== "host"), // the browser sets Host itself
  )
  const candidates: Record<string, string> = {
    "x-amz-checksum-sha256": checksumSha256Base64,
    "x-amz-meta-life-os-sha256": checksumSha256Base64,
    "x-amz-server-side-encryption": "AES256",
  }
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(candidates)) if (signed.has(name)) headers[name] = value
  // Content-Type is not an `x-amz-*` header, so it is safe to send unsigned —
  // and it must be sent: finalize compares the stored object's MIME type against
  // the intent, and S3 would otherwise default it to binary/octet-stream and
  // fail that check.
  headers["content-type"] = mimeType
  return headers
}

export function safeFilename(filename: string) {
  const base = path.basename(filename).normalize("NFKC")
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160)
  return safe || "upload"
}

export function sha256HexToBase64(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("SHA-256 must be a 64-character hexadecimal value")
  return Buffer.from(value, "hex").toString("base64")
}

export function bytesToReadable(bytes: Uint8Array) {
  return Readable.from(Buffer.from(bytes))
}

import test from "node:test"
import assert from "node:assert/strict"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { uploadHeadersFor } from "../src/storage"

// Signing is local math, so this needs no AWS account — dummy credentials
// produce a real, inspectable presigned URL.
async function presign() {
  const client = new S3Client({
    region: "us-west-1",
    credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  })
  return getSignedUrl(client, new PutObjectCommand({
    Bucket: "life-os-files-test",
    Key: "workspaces/w1/files/i1/photo.jpg",
    ContentType: "image/jpeg",
    ChecksumSHA256: CHECKSUM,
    Metadata: { "life-os-sha256": CHECKSUM },
    ServerSideEncryption: "AES256",
  }), { expiresIn: 600 })
}

const CHECKSUM = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="

test("presigned upload sends no x-amz header the signature does not cover", async () => {
  const url = await presign()
  const headers = uploadHeadersFor(url, "image/jpeg", CHECKSUM)
  const signed = new Set(
    (new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "").split(";").filter(name => name && name !== "host"),
  )

  // The bug this pins: the header list was hand-written, so it re-sent
  // x-amz-checksum-sha256 and x-amz-meta-* even though the SDK hoists them into
  // query parameters. SigV4 requires every x-amz-* header to be signed, so S3
  // rejected the upload with 403.
  for (const name of Object.keys(headers)) {
    if (name.startsWith("x-amz-")) {
      assert.ok(signed.has(name), `${name} is sent but not in X-Amz-SignedHeaders — S3 will 403`)
    }
  }

  // Content-Type is not x-amz-*, so unsigned is fine — and it is required,
  // because finalize compares the stored object's MIME type against the intent.
  assert.equal(headers["content-type"], "image/jpeg")

  // Every header the signature does cover must actually be sent, or the
  // signature will not validate.
  for (const name of signed) {
    assert.ok(name in headers, `${name} is signed but not sent — signature will not match`)
  }
})

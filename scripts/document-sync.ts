#!/usr/bin/env tsx
// Watches a local Dropbox folder for dropped-in documents (invoices,
// statements, scans, letters — whatever Joseph puts there) and extracts text
// locally: pdftotext for PDFs, tesseract OCR for images, textutil for
// Office/RTF formats. No cloud API, no account, no recurring cost — Dropbox
// is only acting as a synced drop zone, already mounted locally on this Mac.
//
// Same idempotent pattern as voice-journal-sync.ts: a processed file moves
// into archive/, so a re-run only ever sees genuinely new drops.
//
// Recurses into subfolders. Still one Note per file — no merging — but each
// file's Note carries the subfolder path (if any) in metadata.folder, so a
// group of related files (e.g. "MBA Application/" containing photos, an
// Excel describing them, and a personal statement) stays queryable as a
// collection later without inventing a new primitive for it now.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import type { Base64ImageSource } from "@anthropic-ai/sdk/resources/messages"

const require = createRequire(import.meta.url)
const dotenv = require("dotenv") as { config(options: { path: string; quiet?: boolean }): void }
loadEnv()

const WATCH_DIR = process.env.DOCUMENT_SYNC_DIR ?? "/Users/josephfryer/Dropbox/Life-OS"
const ARCHIVE_DIR = path.join(WATCH_DIR, "archive")
const WORKSPACE_ID = process.env.DOCUMENT_SYNC_WORKSPACE_ID ?? "default-workspace"

const OCR_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".gif"])
const HEIC_EXTENSIONS = new Set([".heic", ".heif"])
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".rtf", ".rtfd", ".odt"])
const PLAIN_TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv"])
const SPREADSHEET_EXTENSIONS = new Set([".xlsx"])

// Below this many non-whitespace characters, tesseract's OCR result is
// treated as "nothing readable" (a real photo, not a scanned document) and
// falls back to a vision-based caption instead.
const MIN_OCR_CHARS = 15
const VISION_MODEL = "claude-haiku-4-5-20251001"
const VISION_FALLBACK_MODEL = "claude-sonnet-4-6"
const IMAGE_MEDIA_TYPES: Record<string, Base64ImageSource["media_type"]> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")

  if (!fs.existsSync(WATCH_DIR)) {
    console.log(`[document-sync] No watch folder at ${WATCH_DIR} — nothing to do.`)
    return
  }

  const files = findFiles(WATCH_DIR)
  if (files.length === 0) {
    console.log("[document-sync] No new documents.")
    return
  }
  console.log(`[document-sync] Found ${files.length} new document(s)`)

  const db = dryRun ? null : (await import("@life-os/db")).db
  let processed = 0
  let failed = 0

  for (const { sourcePath, relativeFolder, filename } of files) {
    try {
      const { text, method } = await extractText(sourcePath)
      const stat = fs.statSync(sourcePath)

      if (dryRun) {
        const preview = text ? text.slice(0, 150).replace(/\s+/g, " ") : "(no text extracted)"
        const label = relativeFolder ? `${relativeFolder}/${filename}` : filename
        console.log(`[document-sync] ${label} [${method}]: "${preview}${text.length > 150 ? "…" : ""}"`)
        continue
      }

      const archiveSubdir = relativeFolder ? path.join(ARCHIVE_DIR, relativeFolder) : ARCHIVE_DIR
      fs.mkdirSync(archiveSubdir, { recursive: true })
      const archivedPath = path.join(archiveSubdir, `${stat.mtime.toISOString().slice(0, 10)}-${filename}`)
      fs.renameSync(sourcePath, archivedPath)

      const importedFile = await db!.importedFile.create({
        data: {
          workspaceId: WORKSPACE_ID,
          filename,
          format: path.extname(filename).slice(1) || "unknown",
          filePath: archivedPath,
          sizeBytes: stat.size,
        },
        select: { id: true },
      })

      const content = text.trim()
        || `Document "${filename}" archived — no text could be extracted (unsupported format for local OCR/text extraction).`

      // Folder-qualified so two different collections with a same-named file
      // (e.g. "resume.pdf" in two different application folders) don't collide.
      const relativePath = relativeFolder ? `${relativeFolder}/${filename}` : filename
      await db!.note.create({
        data: {
          workspaceId: WORKSPACE_ID,
          timestamp: stat.mtime,
          type: "document",
          content,
          metadata: JSON.stringify({
            sourceMarker: `document-sync:${relativePath}`,
            extractionMethod: method,
            folder: relativeFolder,
          }),
          sourceFileId: importedFile.id,
        },
      })

      processed++
      console.log(`[document-sync] ${relativePath} [${method}]: archived and noted`)
    } catch (error) {
      failed++
      console.error(`[document-sync] ${filename} failed:`, error instanceof Error ? error.message : error)
    }
  }

  console.log(`[document-sync] Done. processed=${processed} failed=${failed}`)
  if (db) await db.$disconnect()
}

type FoundFile = { sourcePath: string; relativeFolder: string | null; filename: string }

// Recurses into subfolders (never into archive/, which only ever holds
// already-processed output). relativeFolder is null for files dropped
// directly at the top level — preserves today's flat-drop behavior.
function findFiles(dir: string, relativeFolder: string | null = null): FoundFile[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const results: FoundFile[] = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    if (relativeFolder === null && entry.name === "archive") continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nextFolder = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name
      results.push(...findFiles(fullPath, nextFolder))
    } else if (entry.isFile()) {
      results.push({ sourcePath: fullPath, relativeFolder, filename: entry.name })
    }
  }

  return results.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))
}

async function extractText(sourcePath: string): Promise<{ text: string; method: string }> {
  const ext = path.extname(sourcePath).toLowerCase()

  if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
    return { text: fs.readFileSync(sourcePath, "utf8"), method: "plaintext" }
  }

  if (ext === ".pdf") {
    const text = execFileSync("pdftotext", [sourcePath, "-"], { encoding: "utf8" })
    return { text, method: "pdftotext" }
  }

  if (OFFICE_EXTENSIONS.has(ext)) {
    const text = execFileSync("textutil", ["-convert", "txt", "-stdout", sourcePath], { encoding: "utf8" })
    return { text, method: "textutil" }
  }

  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    return { text: await extractSpreadsheetText(sourcePath), method: "spreadsheet" }
  }

  if (OCR_EXTENSIONS.has(ext)) {
    return ocrThenCaptionIfSparse(sourcePath, ext)
  }

  if (HEIC_EXTENSIONS.has(ext)) {
    const tmpPng = `${sourcePath}.ocr-tmp.png`
    try {
      execFileSync("sips", ["-s", "format", "png", sourcePath, "--out", tmpPng], { stdio: "ignore" })
      return await ocrThenCaptionIfSparse(tmpPng, ".png")
    } finally {
      if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng)
    }
  }

  return { text: "", method: "unsupported" }
}

// OCR is free/local and correct for the common case in this folder (scans,
// screenshots, photographed documents). When it comes back near-empty, this
// is almost certainly a real photo instead — fall back to a vision caption
// so "a photo of the campus visit" is still captured, not silently dropped.
async function ocrThenCaptionIfSparse(imagePath: string, ext: string): Promise<{ text: string; method: string }> {
  const ocrText = execFileSync("tesseract", [imagePath, "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  if (ocrText.replace(/\s/g, "").length >= MIN_OCR_CHARS) {
    return { text: ocrText, method: "tesseract-ocr" }
  }

  const caption = await captionImage(imagePath, ext)
  if (caption) return { text: caption, method: "vision-caption" }
  return { text: ocrText, method: "tesseract-ocr" }
}

async function extractSpreadsheetText(sourcePath: string): Promise<string> {
  const ExcelJS = (await import("exceljs")).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(sourcePath)

  const parts: string[] = []
  workbook.eachSheet(worksheet => {
    parts.push(`--- Sheet: ${worksheet.name} ---`)
    worksheet.eachRow(row => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : []
      parts.push(values.map(v => (v == null ? "" : String(v))).join("\t"))
    })
  })
  return parts.join("\n")
}

async function captionImage(imagePath: string, ext: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const mediaType = IMAGE_MEDIA_TYPES[ext]
  if (!apiKey || !mediaType) return null

  const base64 = fs.readFileSync(imagePath).toString("base64")
  const prompt = "Describe what's in this photo in 1-2 sentences — people, setting, and any visible text worth noting. Plain text only, no preamble."

  try {
    return await callVisionModel(VISION_MODEL, apiKey, mediaType, base64, prompt)
  } catch (error) {
    console.warn("[document-sync] vision caption failed on default model, trying fallback", error instanceof Error ? error.message : error)
    try {
      return await callVisionModel(VISION_FALLBACK_MODEL, apiKey, mediaType, base64, prompt)
    } catch (fallbackError) {
      console.warn("[document-sync] vision caption failed", fallbackError instanceof Error ? fallbackError.message : fallbackError)
      return null
    }
  }
}

async function callVisionModel(
  model: string,
  apiKey: string,
  mediaType: Base64ImageSource["media_type"],
  base64: string,
  prompt: string,
): Promise<string | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model,
    max_tokens: 200,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: prompt },
      ],
    }],
  })
  const text = message.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim()
  return text || null
}

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "apps/persons/.env"),
    path.join(process.cwd(), "apps/persons/.env.local"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})

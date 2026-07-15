#!/usr/bin/env tsx
// Watches a dropped-in-iCloud-Drive folder for voice memos, transcribes them
// locally via whisper.cpp (no cloud, no account, no recurring cost), and
// writes each as a Note (type=voice_transcript). The raw audio is archived
// on disk with a path back from the Note — the raw/derived split: the graph
// holds the transcript, the disk holds the memory.
//
// Idempotent by construction: a processed file is moved into archive/, so a
// re-run only ever sees files that haven't been transcribed yet.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const dotenv = require("dotenv") as { config(options: { path: string; quiet?: boolean }): void }
loadEnv()

const WATCH_DIR = path.join(
  os.homedir(),
  "Library/Mobile Documents/com~apple~CloudDocs/LifeOS/VoiceJournal"
)
const ARCHIVE_DIR = path.join(WATCH_DIR, "archive")
const WHISPER_MODEL = process.env.WHISPER_MODEL_PATH
  ?? path.join(os.homedir(), ".life-os/whisper-models/ggml-base.en.bin")
const WORKSPACE_ID = process.env.VOICE_JOURNAL_WORKSPACE_ID ?? "default-workspace"
const AUDIO_EXTENSIONS = new Set([".m4a", ".wav", ".mp3", ".aiff", ".aif", ".caf"])

async function main() {
  const dryRun = process.argv.includes("--dry-run")

  if (!fs.existsSync(WATCH_DIR)) {
    console.log(`[voice-journal] No watch folder at ${WATCH_DIR} — nothing to do.`)
    return
  }
  if (!fs.existsSync(WHISPER_MODEL)) {
    throw new Error(`Whisper model not found at ${WHISPER_MODEL}. Set WHISPER_MODEL_PATH or download ggml-base.en.bin.`)
  }

  const files = fs.readdirSync(WATCH_DIR)
    .filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort()

  if (files.length === 0) {
    console.log("[voice-journal] No new voice memos.")
    return
  }
  console.log(`[voice-journal] Found ${files.length} new recording(s)`)

  const db = dryRun ? null : (await import("@life-os/db")).db
  let transcribed = 0
  let failed = 0

  for (const filename of files) {
    const sourcePath = path.join(WATCH_DIR, filename)
    try {
      const transcript = transcribeAudio(sourcePath)
      if (!transcript.trim()) {
        console.log(`[voice-journal] ${filename}: empty transcript, skipping`)
        continue
      }

      const stat = fs.statSync(sourcePath)
      if (dryRun) {
        console.log(`[voice-journal] ${filename}: "${transcript.slice(0, 120)}${transcript.length > 120 ? "…" : ""}"`)
        continue
      }

      const archivedPath = path.join(ARCHIVE_DIR, `${stat.mtime.toISOString().slice(0, 10)}-${filename}`)
      fs.renameSync(sourcePath, archivedPath)

      const importedFile = await db!.importedFile.create({
        data: {
          workspaceId: WORKSPACE_ID,
          filename,
          format: path.extname(filename).slice(1),
          filePath: archivedPath,
          sizeBytes: stat.size,
        },
        select: { id: true },
      })

      await db!.note.create({
        data: {
          workspaceId: WORKSPACE_ID,
          timestamp: stat.mtime,
          type: "voice_transcript",
          content: transcript.trim(),
          metadata: JSON.stringify({ sourceMarker: `voice-journal:${filename}` }),
          sourceFileId: importedFile.id,
        },
      })

      transcribed++
      console.log(`[voice-journal] ${filename}: transcribed and archived`)
    } catch (error) {
      failed++
      console.error(`[voice-journal] ${filename} failed:`, error instanceof Error ? error.message : error)
    }
  }

  console.log(`[voice-journal] Done. transcribed=${transcribed} failed=${failed}`)
  if (db) await db.$disconnect()
}

function transcribeAudio(sourcePath: string): string {
  const tmpWav = path.join(os.tmpdir(), `voice-journal-${Date.now()}.wav`)
  try {
    // afconvert is Mac-native — no ffmpeg dependency — down-mixed to the
    // 16kHz mono PCM whisper.cpp expects.
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", sourcePath, tmpWav])
    const output = execFileSync(
      "whisper-cli",
      ["-m", WHISPER_MODEL, "-f", tmpWav, "--no-timestamps"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
    return output
  } finally {
    if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav)
  }
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

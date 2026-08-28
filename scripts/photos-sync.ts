#!/usr/bin/env tsx
// Daily photo digest — reads the local Photos library via osxphotos (no
// iCloud API, no permission dialog, zero recurring cost) and writes one Note
// per day-with-photos summarizing who appeared and what was captured. One
// Note per photo would be Event-bloat at library scale (30k+ photos); a daily
// digest is the same shape as the Health Auto Export pipeline.
//
// Incremental by `date_added` (when a photo entered the library), grouped and
// upserted by the day the photo was *taken* — so an old photo imported today
// still lands on its real date, and re-running never duplicates a day's Note.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { PrismaClient } from "@life-os/db";

const require = createRequire(import.meta.url);
const dotenv = require("dotenv") as {
  config(options: { path: string; quiet?: boolean }): void;
};
loadEnv();

const STATE_PATH = path.join(os.homedir(), ".life-os/photos-sync-state.json");
const WORKSPACE_ID =
  process.env.PHOTOS_SYNC_WORKSPACE_ID ?? "default-workspace";
const SOURCE = "photos-sync";
const MAX_CAPTIONS_PER_DAY = 5;

type OsxPhoto = {
  uuid: string;
  date: string | null;
  date_added: string | null;
  persons: string[];
  ai_caption: string | null;
  original_filename: string | null;
  latitude: number | null;
  longitude: number | null;
  favorite: boolean;
};

let db: PrismaClient;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const state = readState();

  const photos = queryPhotosSince(state.lastAddedAt);
  if (photos.length === 0) {
    console.log("[photos-sync] No new photos.");
    return;
  }
  console.log(`[photos-sync] ${photos.length} new photo(s) since last run`);

  const byDay = groupByDay(photos);
  console.log(`[photos-sync] Spanning ${byDay.size} day(s)`);

  if (dryRun) {
    for (const [day, dayPhotos] of byDay) {
      console.log(
        `  ${day}: ${dayPhotos.length} photo(s), people=${uniquePersons(dayPhotos).join(", ") || "none"}`,
      );
    }
    console.log("[photos-sync] --dry-run: no notes written.");
    return;
  }

  db = (await import("@life-os/db")).db;
  let written = 0;
  for (const [day, dayPhotos] of byDay) {
    await writeDayDigest(day, dayPhotos);
    written++;
  }

  const maxAddedAt = photos
    .map((p) => p.date_added)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  if (maxAddedAt) updateState(maxAddedAt);

  console.log(`[photos-sync] Done. daysWritten=${written}`);
  await db.$disconnect();
}

function queryPhotosSince(addedAfter: string | undefined): OsxPhoto[] {
  // Uses the osxphotos Python API via a small helper script, not the `osxphotos
  // query --json` CLI — the CLI's default JSON dump includes full EXIF/cloud
  // metadata per photo (5-10KB each) which blows past pipe buffer limits at
  // library scale (30k+ photos). JSONL of only the needed fields stays small.
  const scriptPath = path.join(import.meta.dirname, "photos_export.py");
  const output = execFileSync("python3", [scriptPath, addedAfter ?? ""], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
  });
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OsxPhoto);
}

function groupByDay(photos: OsxPhoto[]): Map<string, OsxPhoto[]> {
  const byDay = new Map<string, OsxPhoto[]>();
  for (const photo of photos) {
    if (!photo.date) continue;
    const day = photo.date.slice(0, 10);
    const bucket = byDay.get(day) ?? [];
    bucket.push(photo);
    byDay.set(day, bucket);
  }
  return new Map([...byDay.entries()].sort());
}

function uniquePersons(photos: OsxPhoto[]): string[] {
  return [...new Set(photos.flatMap((p) => p.persons ?? []))].sort();
}

async function writeDayDigest(day: string, photos: OsxPhoto[]) {
  const sourceMarker = `${SOURCE}:day:${day}`;
  const people = uniquePersons(photos);
  const captions = [
    ...new Set(
      photos.map((p) => p.ai_caption).filter((c): c is string => Boolean(c)),
    ),
  ].slice(0, MAX_CAPTIONS_PER_DAY);
  const favorites = photos.filter((p) => p.favorite).length;

  const content = [
    `${photos.length} photo(s) on ${day}.`,
    people.length ? `People: ${people.join(", ")}.` : "",
    favorites ? `${favorites} marked favorite.` : "",
    captions.length ? `Highlights: ${captions.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const metadata = JSON.stringify({
    sourceMarker,
    photoCount: photos.length,
    people,
    photos: photos.map((p) => ({
      uuid: p.uuid,
      filename: p.original_filename,
      persons: p.persons,
      caption: p.ai_caption,
      latitude: p.latitude,
      longitude: p.longitude,
    })),
  });

  const existing = await findNoteByMarker(sourceMarker);
  if (existing) {
    await db.note.update({
      where: { id: existing.id },
      data: { content, metadata },
    });
  } else {
    await db.note.create({
      data: {
        workspaceId: WORKSPACE_ID,
        type: "photo_digest",
        timestamp: new Date(`${day}T12:00:00Z`),
        content,
        metadata,
      },
    });
  }
}

async function findNoteByMarker(marker: string) {
  const candidates = await db.note.findMany({
    where: {
      workspaceId: WORKSPACE_ID,
      type: "photo_digest",
      metadata: { contains: marker, mode: "insensitive" as const },
    },
    select: { id: true, metadata: true },
    take: 5,
  });
  return (
    candidates.find((c) => {
      try {
        return JSON.parse(c.metadata ?? "{}").sourceMarker === marker;
      } catch {
        return false;
      }
    }) ?? null
  );
}

type SyncState = { lastAddedAt?: string };

function readState(): SyncState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as SyncState;
  } catch {
    return {};
  }
}

function updateState(lastAddedAt: string) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify({ lastAddedAt }, null, 2)}\n`);
}

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "apps/persons/.env"),
    path.join(process.cwd(), "apps/persons/.env.local"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate))
      dotenv.config({ path: candidate, quiet: true });
  }
}

main().catch(async (error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  if (db) await db.$disconnect();
  process.exit(1);
});

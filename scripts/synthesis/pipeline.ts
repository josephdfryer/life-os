#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import type { PrismaClient } from "@life-os/db";
import { triageItems } from "./triage";
import { extractItems } from "./extract";
import { resolveExtraction } from "./resolver";
import { writeExtraction } from "./writer";
import type { RawItem, CaptureState } from "./types";

const require = createRequire(import.meta.url);
const dotenv = require("dotenv") as {
  config(options: { path: string; quiet?: boolean }): void;
};
loadEnv();

// Lazy Anthropic import so missing key fails at run-time not import time
async function getAnthropicClient() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const ARCHIVE_DIR = path.join(REPO_ROOT, "archive");
const STATE_PATH = path.join(REPO_ROOT, "capture", ".state.json");
const WORKSPACE_ID = process.env.SYNTHESIS_WORKSPACE_ID ?? "default-workspace";

let db: PrismaClient;

async function main() {
  db = (await import("@life-os/db")).db;
  const client = await getAnthropicClient();
  const options = parseArgs(process.argv.slice(2));

  console.log(
    `[synthesis] Starting pipeline for date range: ${options.since.toISOString()} → ${options.until.toISOString()}`,
  );

  const items = await collectItems(options.since, options.until);
  console.log(`[synthesis] Collected ${items.length} raw items`);

  if (items.length === 0) {
    console.log("[synthesis] Nothing to process");
    return;
  }

  const triaged = await triageItems(items, client);
  const worthCount = triaged.filter((t) => t.worthExtracting).length;
  console.log(
    `[synthesis] Triaged: ${worthCount}/${items.length} worth extracting`,
  );

  const extracted = await extractItems(triaged, client);
  const extractedCount = extracted.filter((e) => e.extraction !== null).length;
  console.log(`[synthesis] Extracted: ${extractedCount} items`);

  let eventsCreated = 0;
  let interactionsCreated = 0;
  let skipped = 0;

  for (const { item, extraction } of extracted) {
    if (!extraction) continue;
    const resolved = await resolveExtraction(item, extraction, db);
    const result = await writeExtraction(resolved, db);
    if (result.skipped) {
      skipped++;
    } else {
      eventsCreated++;
      interactionsCreated += result.interactionsCreated;
    }
  }

  updateSynthesisState(options.until);

  console.log(
    `[synthesis] Done: eventsCreated=${eventsCreated} interactionsCreated=${interactionsCreated} skipped=${skipped}`,
  );
}

async function collectItems(since: Date, until: Date): Promise<RawItem[]> {
  const items: RawItem[] = [];

  // Archive-based sources (whatsapp, calls)
  for (const source of ["whatsapp", "calls"] as const) {
    const sourceDir = path.join(ARCHIVE_DIR, source);
    if (!fs.existsSync(sourceDir)) continue;

    const files = fs
      .readdirSync(sourceDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const file of files) {
      const fileDate = new Date(file.replace(".json", ""));
      if (fileDate < since || fileDate > until) continue;

      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(sourceDir, file), "utf8"),
        ) as unknown[];
        for (const record of raw) {
          const item = archiveRecordToRawItem(
            source,
            record,
            path.join(sourceDir, file),
          );
          if (item) items.push(item);
        }
      } catch (error) {
        console.warn(`[synthesis] Failed to read ${file}:`, error);
      }
    }
  }

  // DB-based sources (imessage, gmail, calendar) — pull recent unprocessed interactions
  const dbItems = await collectDbItems(since, until);
  items.push(...dbItems);

  return items;
}

async function collectDbItems(since: Date, until: Date): Promise<RawItem[]> {
  const interactions = await db.interaction.findMany({
    where: {
      workspaceId: WORKSPACE_ID,
      timestamp: { gte: since, lte: until },
      // Only items not yet synthesized
      NOT: { notes: { contains: "synthesis:", mode: "insensitive" as const } },
    },
    select: {
      id: true,
      type: true,
      timestamp: true,
      summary: true,
      notes: true,
      duration: true,
      person: {
        select: { first: true, last: true, emails: true, phones: true },
      },
    },
    orderBy: { timestamp: "asc" },
    take: 500,
  });

  return interactions.map((interaction) => {
    const name = interaction.person
      ? [interaction.person.first, interaction.person.last]
          .filter(Boolean)
          .join(" ")
      : "Unknown";
    const identifier =
      safeJsonArray(interaction.person?.emails ?? "[]")[0] ??
      safeJsonArray(interaction.person?.phones ?? "[]")[0] ??
      interaction.id;

    return {
      source: "imessage" as const,
      id: interaction.id,
      timestamp: interaction.timestamp.toISOString(),
      body: interaction.summary ?? interaction.notes ?? "",
      participants: [{ name, identifier }],
      durationSeconds: interaction.duration
        ? interaction.duration * 60
        : undefined,
      dbInteractionId: interaction.id,
    };
  });
}

function archiveRecordToRawItem(
  source: "whatsapp" | "calls",
  record: unknown,
  archivePath: string,
): RawItem | null {
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;

  if (source === "whatsapp") {
    const id = String(r.id ?? "");
    const text = String(r.text ?? "");
    const timestamp = String(r.timestamp ?? "");
    if (!id || !text || !timestamp) return null;
    return {
      source: "whatsapp",
      id: `whatsapp:${id}`,
      timestamp,
      body: text,
      participants: [
        {
          name: String(r.partnerName ?? ""),
          identifier: String(r.fromJid ?? r.chatJid ?? id),
        },
      ],
      archivePath,
    };
  }

  if (source === "calls") {
    const id = String(r.id ?? "");
    const address = String(r.address ?? "");
    const timestamp = String(r.timestamp ?? "");
    if (!id || !timestamp) return null;
    const direction = r.originated ? "outbound" : "inbound";
    const answered = Boolean(r.answered);
    const duration =
      typeof r.durationSeconds === "number" ? r.durationSeconds : 0;
    return {
      source: "calls",
      id: `calls:${id}`,
      timestamp,
      body: `${direction} ${answered ? "answered" : "missed"} call${duration ? ` (${Math.round(duration / 60)}m)` : ""} via ${r.serviceProvider ?? "phone"}`,
      participants: [
        { name: String(r.displayName ?? ""), identifier: address },
      ],
      durationSeconds: duration,
      archivePath,
    };
  }

  return null;
}

function updateSynthesisState(until: Date) {
  const state = readState();
  state.synthesis = {
    lastProcessedDate: until.toISOString().slice(0, 10),
    updatedAt: new Date().toISOString(),
  };
  writeState(state);
}

function readState(): CaptureState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as CaptureState;
  } catch {
    return {};
  }
}

function writeState(state: CaptureState) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

type Options = {
  since: Date;
  until: Date;
};

function parseArgs(args: string[]): Options {
  let days = 1;
  let since: Date | null = null;
  let until: Date | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--days" && next) {
      days = Number(next);
      i++;
    } else if (arg === "--since" && next) {
      since = new Date(next);
      i++;
    } else if (arg === "--until" && next) {
      until = new Date(next);
      i++;
    }
  }

  const now = new Date();
  return {
    since: since ?? new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    until: until ?? now,
  };
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

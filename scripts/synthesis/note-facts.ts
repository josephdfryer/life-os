#!/usr/bin/env tsx
// Lightweight fact extraction for captured Notes (document, voice_transcript,
// photo_digest) — pulls a one-line summary + a short key/value fact list out
// of raw text so the assistant can reason over ~150 tokens instead of
// dumping a 200-character truncation of a 200,000-character lease.
//
// Modeled directly on apps/places/server/domain/enrichment.ts's
// enrichVisit/callClaudeForEnrichment/parseEnrichmentResult: structured
// JSON-in/JSON-out, fence-stripped manual parsing with field clamping, no
// schema library. Writes back into the same Note's own metadata — no new
// tables, no entity resolution, no State/Plan promotion (deliberately
// deferred; see docs/PERSONS_ARCHITECTURE.md-style provenance conventions).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@life-os/db";

const require = createRequire(import.meta.url);
const dotenv = require("dotenv") as {
  config(options: { path: string; quiet?: boolean }): void;
};
loadEnv();

const WORKSPACE_ID = process.env.NOTE_FACTS_WORKSPACE_ID ?? "default-workspace";
const MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;
const EXTRACTABLE_TYPES = [
  "document",
  "voice_transcript",
  "photo_digest",
] as const;
const CONTENT_CAP: Record<string, number> = {
  document: 16_000,
  voice_transcript: 4_000,
  photo_digest: 4_000,
};

type NoteFacts = {
  summary: string;
  facts: Array<{ key: string; value: string }>;
  entities: string[];
};

let db: PrismaClient;
let anthropicClient: Anthropic | null = null;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit =
    Number(process.argv.find((_, i, arr) => arr[i - 1] === "--limit")) || 100;

  db = (await import("@life-os/db")).db;

  const notes = await db.note.findMany({
    where: {
      workspaceId: WORKSPACE_ID,
      type: { in: [...EXTRACTABLE_TYPES] },
      NOT: {
        metadata: { contains: '"extraction":', mode: "insensitive" as const },
      },
    },
    select: { id: true, type: true, content: true, metadata: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  if (notes.length === 0) {
    console.log("[note-facts] Nothing to extract.");
    await db.$disconnect();
    return;
  }
  console.log(`[note-facts] ${notes.length} note(s) awaiting extraction`);

  let extracted = 0;
  let skipped = 0;
  for (let index = 0; index < notes.length; index += BATCH_SIZE) {
    const batch = notes.slice(index, index + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (note) => {
        try {
          const cap = CONTENT_CAP[note.type] ?? 4_000;
          const facts = await callClaudeForFacts(
            note.type,
            note.content.slice(0, cap),
          );
          if (!facts) return "skipped" as const;

          if (dryRun) {
            console.log(
              `[note-facts] ${note.id} (${note.type}): ${facts.summary}`,
            );
            console.log(
              `  facts: ${facts.facts.map((f) => `${f.key}=${f.value}`).join(", ") || "(none)"}`,
            );
            console.log(`  entities: ${facts.entities.join(", ") || "(none)"}`);
            return "extracted" as const;
          }

          const existingMetadata = parseMetadata(note.metadata);
          const metadata = JSON.stringify({
            ...existingMetadata,
            extraction: { ...facts, extractedAt: new Date().toISOString() },
          });
          await db.note.update({ where: { id: note.id }, data: { metadata } });
          return "extracted" as const;
        } catch (error) {
          console.error(
            `[note-facts] ${note.id} failed:`,
            error instanceof Error ? error.message : error,
          );
          return "skipped" as const;
        }
      }),
    );
    extracted += results.filter((r) => r === "extracted").length;
    skipped += results.filter((r) => r === "skipped").length;
    if (index + BATCH_SIZE < notes.length) await delay(BATCH_DELAY_MS);
  }

  console.log(
    `[note-facts] Done. extracted=${extracted} skipped=${skipped}${dryRun ? " (--dry-run, nothing written)" : ""}`,
  );
  await db.$disconnect();
}

async function callClaudeForFacts(
  noteType: string,
  content: string,
): Promise<NoteFacts | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    throw new Error("Note fact extraction requires ANTHROPIC_API_KEY");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  anthropicClient ??= new Anthropic({ apiKey });

  const message = await anthropicClient.messages.create({
    model: MODEL,
    max_tokens: 500,
    system:
      "You extract compact key facts from captured personal notes. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          task: "Extract a short summary and the most important key facts from this captured note.",
          noteType,
          content,
          responseShape: {
            summary: "one sentence, plain language",
            facts:
              "array of up to 8 {key, value} pairs — dates, amounts, names, anything a person would want to look up later",
            entities:
              "array of up to 6 named people/places/organizations mentioned",
          },
        }),
      },
    ],
  });

  return parseNoteFacts(
    message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n"),
  );
}

function parseNoteFacts(text: string): NoteFacts | null {
  try {
    const json = JSON.parse(stripJsonFence(text)) as unknown;
    if (!isRecord(json)) return null;
    if (typeof json.summary !== "string") return null;

    const facts = Array.isArray(json.facts)
      ? json.facts
          .filter(
            (f): f is Record<string, unknown> =>
              isRecord(f) &&
              typeof f.key === "string" &&
              typeof f.value === "string",
          )
          .slice(0, 8)
          .map((f) => ({
            key: String(f.key).slice(0, 60),
            value: String(f.value).slice(0, 200),
          }))
      : [];

    const entities = Array.isArray(json.entities)
      ? json.entities
          .filter((e): e is string => typeof e === "string")
          .slice(0, 6)
          .map((e) => e.slice(0, 100))
      : [];

    return { summary: json.summary.slice(0, 300), facts, entities };
  } catch (error) {
    console.warn("[note-facts] failed to parse Claude JSON", { error, text });
    return null;
  }
}

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

#!/usr/bin/env tsx

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { PrismaClient } from "@life-os/db";
import {
  appendDailySourceInteraction,
  createReviewItem,
} from "@life-os/domain";

type BetterSqliteDatabase = {
  pragma(sql: string): unknown;
  prepare<TParams extends unknown[] = unknown[], TResult = unknown>(
    sql: string,
  ): {
    all(...params: TParams): TResult[];
    get(...params: TParams): TResult | undefined;
  };
  close(): void;
};

export type WhatsAppMessageRow = {
  messageId: number;
  stanzaId: string | null;
  text: string | null;
  appleDate: number | bigint | null;
  isFromMe: number | null;
  fromJid: string | null;
  toJid: string | null;
  chatJid: string | null;
  partnerName: string | null;
  groupInfoId: number | null;
  messageType: number | null;
};

type ExistingPerson = {
  id: string;
  first: string;
  last: string;
  phones: string;
};

export type PersonMatchIndexes = {
  byPhone: Map<string, ExistingPerson>;
  byName: Map<string, ExistingPerson>;
};

type State = {
  lastMessageId: number;
  updatedAt: string;
};

type Options = {
  chatDbPath: string;
  statePath: string;
  limit: number;
  dryRun: boolean;
  initWatermark: boolean;
};

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => BetterSqliteDatabase;
const dotenv = require("dotenv") as {
  config(options: { path: string; quiet?: boolean }): void;
};

loadEnv();

let db: PrismaClient;
let normalizePhone: (value: string) => string | null;
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
const SOURCE = "whatsapp";
const SOURCE_PREFIX = `${SOURCE}:`;
const WORKSPACE_ID =
  process.env.WHATSAPP_SYNC_WORKSPACE_ID ?? "default-workspace";
const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite",
);

async function main() {
  const dbModule = await import("@life-os/db");
  db = dbModule.db;
  normalizePhone = dbModule.normalizePhoneDigits;
  const options = parseArgs(process.argv.slice(2));

  if (options.initWatermark) {
    const maxMessageId = readMaxMessageId(options.chatDbPath);
    writeState(options.statePath, {
      lastMessageId: maxMessageId,
      updatedAt: new Date().toISOString(),
    });
    console.log(
      `Initialized WhatsApp sync watermark at message ID ${maxMessageId}; history will not be imported.`,
    );
    return;
  }

  const result = await syncOnce(options);
  console.log(
    `WhatsApp sync: scanned=${result.scanned} imported=${result.imported} staged=${result.staged} ` +
      `skippedExisting=${result.skippedExisting} skippedUnsupported=${result.skippedUnsupported} watermark=${result.watermark}`,
  );
}

async function syncOnce(options: Options) {
  const state = readState(options.statePath);
  const messages = readMessages(
    options.chatDbPath,
    state.lastMessageId,
    options.limit,
  );
  const people = await loadPersonMatchers();
  let imported = 0;
  let staged = 0;
  let skippedExisting = 0;
  let skippedUnsupported = 0;
  let watermark = state.lastMessageId;

  for (const message of messages) {
    watermark = Math.max(watermark, message.messageId);
    const contact = contactFromMessage(message);
    const body = message.text?.trim();
    if (!contact || !body) {
      skippedUnsupported++;
      continue;
    }

    const sourceId = stableSourceId(message);
    const timestamp = appleDateToDate(message.appleDate);
    const person = matchPersonForContact(contact, people);

    if (options.dryRun) {
      console.log(
        `[dry-run] ${sourceId} ${contact.displayName} ${contact.direction}: ${snippet(body)}`,
      );
      continue;
    }

    if (await hasImportedMessage(sourceId)) {
      skippedExisting++;
      continue;
    }

    if (person) {
      await appendDailyInteraction({
        personId: person.id,
        sourceId,
        timestamp,
        direction: contact.direction,
        body,
      });
      imported++;
    } else {
      await stageInboxRecord({
        sourceId,
        timestamp,
        direction: contact.direction,
        displayName: contact.displayName,
        phone: contact.phone,
        body,
        message,
      });
      staged++;
    }
  }

  if (!options.dryRun && watermark > state.lastMessageId) {
    writeState(options.statePath, {
      lastMessageId: watermark,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    scanned: messages.length,
    imported,
    staged,
    skippedExisting,
    skippedUnsupported,
    watermark,
  };
}

function readMessages(
  chatDbPath: string,
  afterId: number,
  limit: number,
): WhatsAppMessageRow[] {
  const sqlite = openWhatsAppDb(chatDbPath);
  try {
    sqlite.pragma("query_only = ON");
    return sqlite
      .prepare<unknown[], WhatsAppMessageRow>(
        `
      SELECT
        m.Z_PK AS messageId,
        m.ZSTANZAID AS stanzaId,
        m.ZTEXT AS text,
        m.ZMESSAGEDATE AS appleDate,
        m.ZISFROMME AS isFromMe,
        m.ZFROMJID AS fromJid,
        m.ZTOJID AS toJid,
        c.ZCONTACTJID AS chatJid,
        c.ZPARTNERNAME AS partnerName,
        c.ZGROUPINFO AS groupInfoId,
        m.ZMESSAGETYPE AS messageType
      FROM ZWAMESSAGE m
      LEFT JOIN ZWACHATSESSION c ON c.Z_PK = m.ZCHATSESSION
      WHERE m.Z_PK > ?
      ORDER BY m.Z_PK ASC
      LIMIT ?
    `,
      )
      .all(afterId, limit);
  } finally {
    sqlite.close();
  }
}

function readMaxMessageId(chatDbPath: string): number {
  const sqlite = openWhatsAppDb(chatDbPath);
  try {
    const row = sqlite
      .prepare<[], { maxMessageId: number | null }>(
        "SELECT MAX(Z_PK) AS maxMessageId FROM ZWAMESSAGE",
      )
      .get();
    return row?.maxMessageId ?? 0;
  } finally {
    sqlite.close();
  }
}

function openWhatsAppDb(chatDbPath: string): BetterSqliteDatabase {
  try {
    const sqlite = new Database(chatDbPath, {
      readonly: true,
      fileMustExist: true,
    });
    const required = ["ZWAMESSAGE", "ZWACHATSESSION"];
    const rows = sqlite
      .prepare<unknown[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('ZWAMESSAGE', 'ZWACHATSESSION')",
      )
      .all();
    const found = new Set(rows.map((row) => row.name));
    if (required.some((name) => !found.has(name))) {
      sqlite.close();
      throw new Error("required WhatsApp message tables were not found");
    }
    return sqlite;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not open WhatsApp database at ${chatDbPath}: ${message}. ` +
        "Make sure WhatsApp Desktop is installed and grant Full Disk Access to the process running this script.",
    );
  }
}

async function loadPersonMatchers() {
  const persons = await db.person.findMany({
    where: { workspaceId: WORKSPACE_ID },
    select: { id: true, first: true, last: true, phones: true },
  });
  return buildPersonMatchIndexes(persons, normalizePhone);
}

export function buildPersonMatchIndexes(
  persons: ExistingPerson[],
  normalize: (value: string) => string | null,
): PersonMatchIndexes {
  const byPhone = new Map<string, ExistingPerson>();
  const byName = new Map<string, ExistingPerson>();
  const ambiguousPhones = new Set<string>();
  const ambiguousNames = new Set<string>();
  for (const person of persons) {
    for (const phone of parseJsonArray(person.phones)) {
      const normalized = normalize(phone);
      if (!normalized || ambiguousPhones.has(normalized)) continue;
      if (byPhone.has(normalized)) {
        byPhone.delete(normalized);
        ambiguousPhones.add(normalized);
      } else {
        byPhone.set(normalized, person);
      }
    }

    const name = normalizeContactName(`${person.first} ${person.last}`);
    if (!name || ambiguousNames.has(name)) continue;
    if (byName.has(name)) {
      byName.delete(name);
      ambiguousNames.add(name);
    } else {
      byName.set(name, person);
    }
  }
  return { byPhone, byName };
}

export function matchPersonForContact(
  contact: { phone: string; displayName: string },
  indexes: PersonMatchIndexes,
) {
  return (
    indexes.byPhone.get(contact.phone) ??
    indexes.byName.get(normalizeContactName(contact.displayName)) ??
    null
  );
}

export function contactFromMessage(message: WhatsAppMessageRow) {
  if (
    message.groupInfoId ||
    isGroupJid(message.chatJid) ||
    isGroupJid(message.fromJid)
  )
    return null;
  const jid =
    message.chatJid ?? (message.isFromMe ? message.toJid : message.fromJid);
  const phone = phoneFromJid(jid);
  if (!phone) return null;
  const partnerName = cleanName(message.partnerName);
  return {
    phone,
    displayName:
      partnerName && !looksLikeIdentifier(partnerName) ? partnerName : phone,
    direction: message.isFromMe ? "outbound" : "inbound",
  };
}

export function phoneFromJid(jid: string | null | undefined): string | null {
  const value = jid?.trim().toLowerCase();
  if (!value || value.endsWith("@g.us") || value.endsWith("@lid")) return null;
  const local = value.split("@")[0].split(":")[0];
  const digits = local.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function isGroupJid(jid: string | null | undefined) {
  return Boolean(jid?.trim().toLowerCase().endsWith("@g.us"));
}

export function stableSourceId(
  message: Pick<WhatsAppMessageRow, "messageId" | "stanzaId">,
) {
  return message.stanzaId?.trim() || String(message.messageId);
}

async function hasImportedMessage(sourceId: string) {
  const staged = await db.stagedInteraction.findUnique({
    where: {
      workspaceId_source_sourceId: {
        workspaceId: WORKSPACE_ID,
        source: SOURCE,
        sourceId,
      },
    },
    select: { id: true },
  });
  if (staged) return true;

  const marker = `${SOURCE_PREFIX}${sourceId}`;
  const candidates = await db.interaction.findMany({
    where: {
      workspaceId: WORKSPACE_ID,
      notes: { contains: marker, mode: "insensitive" as const },
    },
    select: { notes: true },
    take: 20,
  });
  return candidates.some((candidate) =>
    sourceMarkers(candidate.notes).includes(marker),
  );
}

// Delegates to the shared day-bucket-append command (packages/domain/
// staged-interactions.ts) rather than the hand-rolled version this used to
// carry — that file's own header names this script and scripts/imessage-
// sync.ts as the two independent copies it exists to unify (imessage-sync
// migrated first). Same two real gains as that migration: this now creates
// InteractionParticipant rows (never did before) and publishes a GraphEvent.
// The AuditLog write stays — appendDailySourceInteraction only publishes a
// GraphEvent, not an AuditLog entry (that only happens one level up, inside
// acceptStagedInteraction), so dropping this would silently remove
// whatsapp-sync activity from the Admin audit log. One knob dropped:
// WHATSAPP_SYNC_DAY_TIME_ZONE, a per-script env override nothing else in
// the system had.
async function appendDailyInteraction(input: {
  personId: string;
  sourceId: string;
  timestamp: Date;
  direction: string;
  body: string;
}) {
  const result = await appendDailySourceInteraction({
    personId: input.personId,
    source: SOURCE,
    sourceId: input.sourceId,
    type: "message",
    timestamp: input.timestamp,
    summary: input.body,
    direction: input.direction,
    workspaceId: WORKSPACE_ID,
    actor: { type: "system", workspaceId: WORKSPACE_ID },
  });
  await writeAudit("interaction.create", "interaction", result.interactionId, {
    mode: result.created ? "create" : result.updated ? "append" : "skip",
    source: SOURCE,
    sourceId: input.sourceId,
  });
}

async function stageInboxRecord(input: {
  sourceId: string;
  timestamp: Date;
  direction: string;
  displayName: string;
  phone: string;
  body: string;
  message: WhatsAppMessageRow;
}) {
  const staged = await db.stagedInteraction.upsert({
    where: {
      workspaceId_source_sourceId: {
        workspaceId: WORKSPACE_ID,
        source: SOURCE,
        sourceId: input.sourceId,
      },
    },
    update: {
      contactName: input.displayName,
      contactPhone: input.phone,
      timestamp: input.timestamp,
      summary: snippet(input.body),
      body: input.body,
      direction: input.direction,
      metadata: JSON.stringify({
        stanzaId: input.message.stanzaId,
        chatJid: input.message.chatJid,
      }),
    },
    create: {
      workspaceId: WORKSPACE_ID,
      source: SOURCE,
      sourceId: input.sourceId,
      itemType: "interaction",
      status: "pending",
      type: "message",
      contactName: input.displayName,
      contactPhone: input.phone,
      timestamp: input.timestamp,
      summary: snippet(input.body),
      body: input.body,
      direction: input.direction,
      metadata: JSON.stringify({
        stanzaId: input.message.stanzaId,
        chatJid: input.message.chatJid,
      }),
    },
    select: { id: true },
  });
  await writeAudit("inbox.stage", "stagedInteraction", staged.id, {
    source: SOURCE,
    sourceId: input.sourceId,
    itemType: "interaction",
  });
  // Best-effort — without this, a WhatsApp message from an unmatched
  // contact would never appear in the unified Inbox (apps/home), only in
  // this script's own StagedInteraction rows.
  await createReviewItem({
    workspaceId: WORKSPACE_ID,
    source: "staged_interaction",
    sourceId: staged.id,
    itemType: "interaction",
    command: "staged_interaction.accept",
    commandInput: { stagedInteractionId: staged.id },
    riskTier: "review",
  });
}

async function writeAudit(
  action: "interaction.create" | "inbox.stage",
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: WORKSPACE_ID,
        action,
        targetType,
        targetId,
        actorType: "system",
        actorLabel: "WhatsApp desktop sync",
        metadata: JSON.stringify(metadata),
      },
    });
  } catch (error) {
    console.warn("[whatsapp] Could not write audit record", error);
  }
}

export function appleDateToDate(value: WhatsAppMessageRow["appleDate"]): Date {
  const raw = typeof value === "bigint" ? Number(value) : (value ?? 0);
  if (!raw) return new Date();
  if (raw > 100_000_000_000_000)
    return new Date(APPLE_EPOCH_MS + raw / 1_000_000);
  if (raw > 100_000_000_000) return new Date(APPLE_EPOCH_MS + raw / 1_000);
  return new Date(APPLE_EPOCH_MS + raw * 1000);
}

function sourceMarkers(notes: string | null | undefined) {
  return (notes ?? "")
    .split(/\s+/)
    .filter((part) => part.startsWith(SOURCE_PREFIX));
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function cleanName(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function normalizeContactName(value: string | null | undefined) {
  return cleanName(value)?.toLocaleLowerCase() ?? "";
}

function looksLikeIdentifier(value: string) {
  return value.includes("@") || value.replace(/\D/g, "").length >= 7;
}

function snippet(value: string, max = 240) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function readState(statePath: string): State {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(statePath, "utf8"),
    ) as Partial<State>;
    return {
      lastMessageId: Number(parsed.lastMessageId ?? 0),
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { lastMessageId: 0, updatedAt: new Date(0).toISOString() };
  }
}

function writeState(statePath: string, state: State) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    chatDbPath: process.env.WHATSAPP_DB_PATH ?? DEFAULT_DB_PATH,
    statePath:
      process.env.WHATSAPP_SYNC_STATE_PATH ??
      path.join(os.homedir(), ".life-os/whatsapp-sync-state.json"),
    limit: Number(process.env.WHATSAPP_SYNC_LIMIT ?? 500),
    dryRun: false,
    initWatermark: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--init-watermark") options.initWatermark = true;
    else if (arg === "--db" && next)
      ((options.chatDbPath = expandHome(next)), i++);
    else if (arg === "--state" && next)
      ((options.statePath = expandHome(next)), i++);
    else if (arg === "--limit" && next) ((options.limit = Number(next)), i++);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 5000
  ) {
    throw new Error("--limit must be an integer between 1 and 5000");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: npm run whatsapp:sync -- [options]

Options:
  --init-watermark  Start from the latest WhatsApp message; import no history.
  --dry-run         Show new supported messages without writing or advancing state.
  --db <path>       Override the WhatsApp ChatStorage.sqlite path.
  --state <path>    Override the watermark state path.
  --limit <count>   Maximum rows per run. Defaults to 500.
`);
}

function expandHome(value: string) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function loadEnv() {
  for (const candidate of [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "packages/db/.env"),
    path.join(process.cwd(), "apps/persons/.env"),
    path.join(process.cwd(), "apps/persons/.env.local"),
  ]) {
    if (fs.existsSync(candidate))
      dotenv.config({ path: candidate, quiet: true });
  }
}

async function disconnectDb() {
  if (db) await db.$disconnect();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch(async (error) => {
      console.error(
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      await disconnectDb();
      process.exitCode = 1;
    })
    .finally(disconnectDb);
}

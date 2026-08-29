#!/usr/bin/env tsx

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as SourceClient } from "../../packages/db/generated/sqlite-prisma/client";
import { PrismaClient as TargetClient } from "../../packages/db/generated/prisma/client";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_SCHEMA = path.join(
  ROOT,
  "packages/db/prisma/schema.sqlite.prisma",
);
const BATCH_SIZE = 1_000;
const EXECUTE = process.argv.includes("--execute");

type Delegate = {
  count(): Promise<number>;
  findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  createMany(args: {
    data: Record<string, unknown>[];
  }): Promise<{ count: number }>;
};

type ModelSpec = {
  name: string;
  delegate: string;
  idFields: string[];
  hasWorkspaceId: boolean;
};

type Repairs = {
  Workspace: Array<Record<string, unknown>>;
  Note: Array<Record<string, unknown>>;
};

async function main() {
  const env = loadEnvironment();
  const specs = parseModels(fs.readFileSync(SOURCE_SCHEMA, "utf8"));
  const source = new SourceClient({
    adapter: new PrismaLibSql({
      url: env.sourceUrl,
      authToken: env.sourceToken,
    }),
    log: ["error"],
  });
  const target = new TargetClient({
    adapter: new PrismaPg({ connectionString: env.targetUrl }),
    log: ["error"],
  });

  try {
    const sourceCounts = await modelCounts(source, specs);
    const targetCounts = await modelCounts(target, specs);
    const nonEmptyTargets = Object.entries(targetCounts).filter(
      ([, count]) => count !== 0,
    );

    console.log(
      JSON.stringify(
        {
          mode: EXECUTE ? "execute" : "preview",
          models: specs.length,
          sourceRows: sumCounts(sourceCounts),
          targetRows: sumCounts(targetCounts),
          nonEmptyTargets,
        },
        null,
        2,
      ),
    );

    if (!EXECUTE) {
      console.log(
        "Preview only. Re-run with --execute to import into an empty target.",
      );
      return;
    }
    if (nonEmptyTargets.length) {
      throw new Error(
        `Target is not empty: ${nonEmptyTargets.map(([name, count]) => `${name}=${count}`).join(", ")}`,
      );
    }

    const copiedCounts: Record<string, number> = {};
    const sourceHashes: Record<string, string> = {};
    const repairs = await buildRepairs(source, specs);
    console.log(JSON.stringify({ migrationRepairs: repairs }, null, 2));

    await target.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");
        if (repairs.Workspace.length)
          await transaction.workspace.createMany({
            data: repairs.Workspace as never[],
          });
        if (repairs.Note.length)
          await transaction.note.createMany({ data: repairs.Note as never[] });
        for (const spec of specs) {
          const sourceDelegate = getDelegate(source, spec);
          const targetDelegate = getDelegate(transaction, spec);
          const hash = createHash("sha256");
          let copied = 0;

          await forEachBatch(sourceDelegate, spec, async (rows) => {
            for (const row of rows) hash.update(canonical(row)).update("\n");
            const result = await targetDelegate.createMany({ data: rows });
            if (result.count !== rows.length) {
              throw new Error(
                `${spec.name}: attempted ${rows.length}, inserted ${result.count}`,
              );
            }
            copied += result.count;
          });

          copiedCounts[spec.name] = copied;
          sourceHashes[spec.name] = hash.digest("hex");
          console.log(`${spec.name.padEnd(30)} ${String(copied).padStart(8)}`);
        }
      },
      { maxWait: 60_000, timeout: 30 * 60_000 },
    );

    const report = await validateCopy(
      target,
      specs,
      copiedCounts,
      sourceHashes,
      repairs,
    );
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  } finally {
    await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
  }
}

function loadEnvironment() {
  for (const file of [
    path.join(ROOT, ".env"),
    path.join(ROOT, "apps/persons/.env"),
  ]) {
    if (fs.existsSync(file))
      dotenv.config({ path: file, override: false, quiet: true });
  }
  const local = fs.existsSync(path.join(ROOT, ".env.local"))
    ? dotenv.parse(fs.readFileSync(path.join(ROOT, ".env.local")))
    : {};
  const sourceUrl = process.env.TURSO_DATABASE_URL;
  const sourceToken = process.env.TURSO_AUTH_TOKEN;
  const targetUrl =
    process.env.TARGET_DATABASE_URL ??
    local.DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL_UNPOOLED;

  if (!sourceUrl || !sourceToken)
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
  if (!targetUrl || !/^postgres(ql)?:\/\//.test(targetUrl)) {
    throw new Error(
      "TARGET_DATABASE_URL or .env.local DATABASE_URL_UNPOOLED must be PostgreSQL",
    );
  }
  return { sourceUrl, sourceToken, targetUrl };
}

async function modelCounts(client: object, specs: ModelSpec[]) {
  const entries = await Promise.all(
    specs.map(
      async (spec) =>
        [spec.name, await getDelegate(client, spec).count()] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<string, number>;
}

async function validateCopy(
  target: object,
  specs: ModelSpec[],
  expectedCounts: Record<string, number>,
  sourceHashes: Record<string, string>,
  repairs: Repairs,
) {
  const targetCounts: Record<string, number> = {};
  const targetHashes: Record<string, string> = {};
  const failures: Array<{ model: string; reason: string }> = [];

  for (const spec of specs) {
    const delegate = getDelegate(target, spec);
    const hash = createHash("sha256");
    let count = 0;
    const ignoredIds = new Set(
      (repairs[spec.name as keyof Repairs] ?? []).map((row) => String(row.id)),
    );
    await forEachBatch(delegate, spec, async (rows) => {
      const sourceRows = rows.filter((row) => !ignoredIds.has(String(row.id)));
      for (const row of sourceRows) hash.update(canonical(row)).update("\n");
      count += sourceRows.length;
    });
    const totalCount = await delegate.count();
    targetCounts[spec.name] = count;
    targetHashes[spec.name] = hash.digest("hex");
    if (count !== expectedCounts[spec.name])
      failures.push({
        model: spec.name,
        reason: `count ${expectedCounts[spec.name]} -> ${count}`,
      });
    if (totalCount !== expectedCounts[spec.name] + ignoredIds.size)
      failures.push({
        model: spec.name,
        reason: `total count with repairs ${expectedCounts[spec.name] + ignoredIds.size} -> ${totalCount}`,
      });
    if (targetHashes[spec.name] !== sourceHashes[spec.name])
      failures.push({ model: spec.name, reason: "content hash mismatch" });
  }

  return {
    valid: failures.length === 0,
    models: specs.length,
    sourceRows: sumCounts(expectedCounts),
    targetRows: sumCounts(targetCounts),
    failures,
    repairs,
    sourceHashes,
    targetHashes,
  };
}

async function forEachBatch(
  delegate: Delegate,
  spec: ModelSpec,
  visit: (rows: Record<string, unknown>[]) => Promise<void>,
) {
  if (spec.idFields.length !== 1) {
    const rows = await delegate.findMany(
      spec.idFields.length
        ? { orderBy: spec.idFields.map((field) => ({ [field]: "asc" })) }
        : undefined,
    );
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE)
      await visit(rows.slice(offset, offset + BATCH_SIZE));
    return;
  }

  const id = spec.idFields[0];
  let cursor: unknown;
  for (;;) {
    const rows = await delegate.findMany({
      orderBy: { [id]: "asc" },
      take: BATCH_SIZE,
      ...(cursor === undefined ? {} : { cursor: { [id]: cursor }, skip: 1 }),
    });
    if (!rows.length) return;
    await visit(rows);
    cursor = rows[rows.length - 1][id];
    if (rows.length < BATCH_SIZE) return;
  }
}

function getDelegate(client: object, spec: ModelSpec): Delegate {
  const delegate = (client as Record<string, unknown>)[spec.delegate] as
    Delegate | undefined;
  if (!delegate)
    throw new Error(
      `Missing Prisma delegate ${spec.delegate} for ${spec.name}`,
    );
  return delegate;
}

function parseModels(schema: string): ModelSpec[] {
  const specs: ModelSpec[] = [];
  const pattern = /\bmodel\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  for (const match of schema.matchAll(pattern)) {
    const name = match[1];
    const start = match.index! + match[0].length;
    const end = blockEnd(schema, start);
    const body = schema.slice(start, end);
    const scalarId = body.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+[^\n]*@id\b/m,
    )?.[1];
    const composite =
      body
        .match(/@@id\(\[([^\]]+)\]\)/)?.[1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
    specs.push({
      name,
      delegate: name[0].toLowerCase() + name.slice(1),
      idFields: scalarId ? [scalarId] : composite,
      hasWorkspaceId: /^\s*workspaceId\s+/m.test(body),
    });
  }
  return specs;
}

async function buildRepairs(
  source: SourceClient,
  specs: ModelSpec[],
): Promise<Repairs> {
  const workspaceTables = specs.filter(
    (spec) => spec.hasWorkspaceId && spec.name !== "Workspace",
  );
  const referencedWorkspaceIds = new Set<string>();
  for (const spec of workspaceTables) {
    const rows = await getDelegate(source, spec).findMany({
      select: { workspaceId: true },
      distinct: ["workspaceId"],
    });
    for (const row of rows) {
      if (typeof row.workspaceId === "string")
        referencedWorkspaceIds.add(row.workspaceId);
    }
  }
  const existingWorkspaces = await source.workspace.findMany({
    where: { id: { in: [...referencedWorkspaceIds] } },
    select: { id: true },
  });
  const existingIds = new Set(existingWorkspaces.map((row) => row.id));
  const missingWorkspaces = [...referencedWorkspaceIds]
    .filter((id) => !existingIds.has(id))
    .sort()
    .map((id) => ({ id }));
  const unsafeWorkspace = missingWorkspaces.find(
    (row) => !/(?:test|api)-/i.test(row.id),
  );
  if (unsafeWorkspace) {
    throw new Error(
      `Missing non-test Workspace parent ${unsafeWorkspace.id}; explicit repair decision required`,
    );
  }

  const missingNotes = await source.$queryRawUnsafe<
    Array<{ id: string; workspaceId: string; timestamp: Date | string }>
  >(`SELECT state."sourceNoteId" AS id,
            state."workspaceId" AS "workspaceId",
            MIN(state."recordedAt") AS timestamp
       FROM "State" state
       LEFT JOIN "Note" note ON note.id = state."sourceNoteId"
      WHERE state."sourceNoteId" IS NOT NULL AND note.id IS NULL
      GROUP BY state."sourceNoteId", state."workspaceId"
      ORDER BY state."sourceNoteId"`);
  const unsafeNote = missingNotes.find(
    (row) => !/(?:test|api)-/i.test(row.workspaceId),
  );
  if (unsafeNote) {
    throw new Error(
      `Missing Note ${unsafeNote.id} belongs to non-test workspace ${unsafeNote.workspaceId}`,
    );
  }

  const epoch = new Date(0);
  return {
    Workspace: missingWorkspaces.map((row) => ({
      id: row.id,
      createdAt: epoch,
      updatedAt: epoch,
      name: `Recovered test fixture: ${row.id}`,
      slug: `migration-${createHash("sha256").update(row.id).digest("hex").slice(0, 24)}`,
      status: "orphaned_test_fixture",
      autoMergeEnabled: false,
    })),
    Note: missingNotes.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      createdAt: new Date(row.timestamp),
      timestamp: new Date(row.timestamp),
      type: "migration_placeholder",
      content:
        "Synthetic parent created during the Turso to PostgreSQL migration to preserve orphaned test-fixture State provenance.",
      metadata: JSON.stringify({
        migrationRepair: true,
        reason: "missing_source_note_parent",
      }),
    })),
  };
}

function blockEnd(source: string, start: number) {
  let depth = 1;
  for (let index = start; index < source.length; index++) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error("Unclosed Prisma model block");
}

function canonical(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

function sumCounts(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});

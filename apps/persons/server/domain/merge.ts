import { db } from "@/lib/db"
import { findDuplicates } from "@/lib/dedupe"
import { parseTags } from "@/lib/utils"
import { badRequest, notFound } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"
import { formatPerson } from "./dto"

type PairInput = { keepId: string; deleteId: string }
type ClusterPairInput = { aId: string; bId: string }

type MergePerson = {
  id: string
  createdAt: Date
  first: string
  last: string
  title: string | null
  headline: string | null
  company: string | null
  location: string | null
  birthday: string | null
  notes: string | null
  linkedin: string | null
  twitter: string | null
  website: string | null
  facebook: string | null
  instagram: string | null
  emails: string
  phones: string
  tags: string
  values: string
  closeness: number
  _count: { interactions: number; plans?: number }
}

export type PairResult = {
  keepId: string
  deleteId: string
  score: number
  reason: string
  keepName: string
  deleteName: string
}

const AUTO_THRESHOLD = 0.93
// Each merge is its own transaction: Turso over HTTP makes every statement a
// network round-trip, so batching all merges into one interactive transaction
// blows past Prisma's 5s default and aborts the whole run.
const TX_OPTS = { timeout: 20_000, maxWait: 10_000 }
const mergeSelect = {
  id: true,
  createdAt: true,
  first: true,
  last: true,
  title: true,
  headline: true,
  company: true,
  location: true,
  birthday: true,
  notes: true,
  linkedin: true,
  twitter: true,
  website: true,
  facebook: true,
  instagram: true,
  emails: true,
  phones: true,
  tags: true,
  values: true,
  closeness: true,
  _count: { select: { interactions: true, plans: true } },
} as const

export async function mergePersons(input: PairInput & { fields?: Record<string, unknown> }, workspaceId: string, actor?: DomainActor) {
  validatePair(input)
  await assertPersonsInWorkspace(workspaceId, [input.keepId, input.deleteId])
  const patch = input.fields ? explicitPatch(input.fields) : await automaticPairPatch(input.keepId, input.deleteId, workspaceId)

  await db.$transaction(async tx => {
    await applyMerge(tx, input.keepId, input.deleteId, patch, workspaceId)
  }, TX_OPTS)

  await auditAction({
    actor,
    action: "person.merge",
    targetType: "person",
    targetId: input.keepId,
    metadata: { deletedIds: [input.deleteId], mode: "pair" },
  })

  return { ok: true, keptId: input.keepId }
}

export async function mergePersonPairs(pairs: PairInput[], workspaceId: string, actor?: DomainActor) {
  if (!Array.isArray(pairs) || pairs.length === 0) throw badRequest("pairs required", { field: "pairs" })
  for (const pair of pairs) validatePair(pair)

  const ids = [...new Set(pairs.flatMap(pair => [pair.keepId, pair.deleteId]))]
  await assertPersonsInWorkspace(workspaceId, ids)
  const persons = await db.person.findMany({ where: { id: { in: ids }, workspaceId }, select: mergeSelect })
  const byId = new Map(persons.map(person => [person.id, person as MergePerson]))
  const deletedIds: string[] = []

  for (const pair of pairs) {
    const keeper = byId.get(pair.keepId)
    const loser = byId.get(pair.deleteId)
    if (!keeper || !loser) continue
    const patch = automaticPatch(keeper, loser)
    await db.$transaction(async tx => {
      await applyMerge(tx, pair.keepId, pair.deleteId, patch, workspaceId)
    }, TX_OPTS)
    Object.assign(keeper, patch)
    deletedIds.push(pair.deleteId)
  }

  await auditAction({
    actor,
    action: "person.merge",
    targetType: "person",
    metadata: { deletedIds, mode: "batch" },
  })
  return { merged: deletedIds.length, deletedIds }
}

export async function mergePersonClusters(pairs: ClusterPairInput[], workspaceId: string, actor?: DomainActor) {
  if (!Array.isArray(pairs) || pairs.length === 0) throw badRequest("pairs required", { field: "pairs" })
  const components = buildComponents(pairs)
  if (components.length === 0) return { merged: 0, deletedIds: [] as string[] }

  const ids = [...new Set(components.flat())]
  await assertPersonsInWorkspace(workspaceId, ids)
  const persons = await db.person.findMany({ where: { id: { in: ids }, workspaceId }, select: mergeSelect })
  const byId = new Map(persons.map(person => [person.id, person as MergePerson]))
  const deletedIds: string[] = []

  for (const component of components) {
    const members = component.map(id => byId.get(id)).filter((person): person is MergePerson => Boolean(person))
    if (members.length < 2) continue
    const [keeper, ...losers] = sortByKeepPreference(members)
    const patch = clusterPatch(keeper, losers)
    await db.$transaction(async tx => {
      if (Object.keys(patch).length > 0) {
        await tx.person.updateMany({ where: { id: keeper.id, workspaceId }, data: patch })
      }
      for (const loser of losers) {
        await reassignAndDelete(tx, keeper.id, loser.id, workspaceId)
      }
    }, TX_OPTS)
    deletedIds.push(...losers.map(loser => loser.id))
  }

  await auditAction({
    actor,
    action: "person.merge",
    targetType: "person",
    metadata: { deletedIds, mode: "cluster" },
  })
  return { merged: deletedIds.length, deletedIds }
}

export async function mergeSameEmailPersons(workspaceId: string, actor?: DomainActor) {
  const all = await db.person.findMany({ where: { workspaceId }, select: mergeSelect })
  const byEmail = new Map<string, MergePerson[]>()
  for (const person of all as MergePerson[]) {
    for (const email of parseTags(person.emails)) {
      const key = email.toLowerCase().trim()
      if (!key) continue
      const bucket = byEmail.get(key) ?? []
      bucket.push(person)
      byEmail.set(key, bucket)
    }
  }

  const deleted = new Set<string>()
  const deletedIds: string[] = []
  for (const bucket of byEmail.values()) {
    if (bucket.length < 2) continue
    const [keeper, ...losers] = sortByKeepPreference(bucket)
    for (const loser of losers) {
      if (deleted.has(loser.id) || deleted.has(keeper.id)) continue
      const patch = automaticPatch(keeper, loser)
      await db.$transaction(async tx => {
        await applyMerge(tx, keeper.id, loser.id, patch, workspaceId)
      }, TX_OPTS)
      Object.assign(keeper, patch)
      deleted.add(loser.id)
      deletedIds.push(loser.id)
    }
  }

  await auditAction({
    actor,
    action: "person.merge",
    targetType: "person",
    metadata: { deletedIds, mode: "same-email" },
  })
  return { merged: deletedIds.length, deletedIds }
}

// Stop starting new merges after this long so we return partial progress
// instead of letting Vercel kill the function (maxDuration on the route must
// exceed this). The UI re-invokes until `remaining` is 0.
const DEDUPE_BUDGET_MS = 250_000

export async function autoDedupePersons(workspaceId: string, actor?: DomainActor) {
  const deadline = Date.now() + DEDUPE_BUDGET_MS
  const all = await db.person.findMany({
    where: { workspaceId },
    select: mergeSelect,
  })
  const toMerge = findAutoMergePairs(all as MergePerson[])
  const byId = new Map((all as MergePerson[]).map(person => [person.id, person]))
  const refs = await loserRefSets(toMerge.map(pair => pair.deleteId), workspaceId)
  const results: PairResult[] = []
  const failures: { pair: PairResult; error: string }[] = []
  let remaining = 0

  for (let index = 0; index < toMerge.length; index++) {
    if (Date.now() > deadline) {
      remaining = toMerge.length - index
      break
    }
    const pair = toMerge[index]
    const keeper = byId.get(pair.keepId)
    const loser = byId.get(pair.deleteId)
    if (!keeper || !loser) continue
    const patch = automaticPatch(keeper, loser)
    try {
      await db.$transaction(async tx => {
        if (Object.keys(patch).length > 0) {
          await tx.person.updateMany({ where: { id: pair.keepId, workspaceId }, data: patch })
        }
        await reassignAndDelete(tx, pair.keepId, pair.deleteId, workspaceId, {
          interactions: loser._count.interactions > 0,
          plans: (loser._count.plans ?? 0) > 0,
          stagedCandidate: refs.stagedCandidate.has(pair.deleteId),
          stagedAccepted: refs.stagedAccepted.has(pair.deleteId),
          apiKeys: refs.apiKeys.has(pair.deleteId),
          audits: refs.audits.has(pair.deleteId),
        })
      }, TX_OPTS)
      // Keep the cached keeper in sync so later merges into the same keeper
      // build on already-merged emails/phones/tags instead of stale data.
      Object.assign(keeper, patch)
      results.push(pair)
    } catch (error) {
      // Loser already gone (e.g. deleted by a previous partial run) — done.
      if ((error as { code?: string })?.code === "P2025") continue
      console.error(`[dedupe] merge failed: ${pair.deleteName} → ${pair.keepName}`, error)
      failures.push({ pair, error: error instanceof Error ? error.message : String(error) })
    }
  }

  await auditAction({
    actor,
    action: "person.dedupe",
    targetType: "person",
    metadata: { merged: results.length, failed: failures.length, remaining, deletedIds: results.map(result => result.deleteId) },
  })
  return { merged: results.length, results, failed: failures.length, failures, remaining }
}

// One bulk lookup per referencing table so each merge can skip reassignment
// statements that would touch zero rows — with Turso every statement is a
// network round-trip, and most losers have no staged items, api keys, or
// audit entries.
async function loserRefSets(ids: string[], workspaceId: string) {
  const empty = {
    stagedCandidate: new Set<string>(),
    stagedAccepted: new Set<string>(),
    apiKeys: new Set<string>(),
    audits: new Set<string>(),
  }
  if (ids.length === 0) return empty
  const [stagedCandidate, stagedAccepted, apiKeys, audits] = await Promise.all([
    db.stagedInteraction.findMany({ where: { candidatePersonId: { in: ids }, workspaceId }, select: { candidatePersonId: true } }),
    db.stagedInteraction.findMany({ where: { acceptedPersonId: { in: ids }, workspaceId }, select: { acceptedPersonId: true } }),
    db.apiKey.findMany({ where: { ownerPersonId: { in: ids }, workspaceId }, select: { ownerPersonId: true } }),
    db.auditLog.findMany({ where: { personId: { in: ids }, workspaceId }, select: { personId: true } }),
  ])
  return {
    stagedCandidate: new Set(stagedCandidate.map(row => row.candidatePersonId).filter(Boolean) as string[]),
    stagedAccepted: new Set(stagedAccepted.map(row => row.acceptedPersonId).filter(Boolean) as string[]),
    apiKeys: new Set(apiKeys.map(row => row.ownerPersonId).filter(Boolean) as string[]),
    audits: new Set(audits.map(row => row.personId).filter(Boolean) as string[]),
  }
}

export async function findPersonDuplicates(workspaceId: string) {
  const persons = await db.person.findMany({
    where: { workspaceId },
    include: {
      _count: { select: { interactions: true, plans: true } },
    },
  })

  const parsed = persons.map(person => ({
    ...formatPerson(person),
    interactionCount: person._count.interactions,
    planCount: person._count.plans,
  }))

  return findDuplicates(parsed)
}

function validatePair(pair: PairInput) {
  if (!pair.keepId || !pair.deleteId || pair.keepId === pair.deleteId) {
    throw badRequest("Invalid IDs", { keepId: pair.keepId, deleteId: pair.deleteId })
  }
}

// Guards every merge entry point against cross-tenant IDs: a person ID that
// resolves in another workspace must look identical to a nonexistent one.
async function assertPersonsInWorkspace(workspaceId: string, ids: string[]) {
  const unique = [...new Set(ids)]
  const rows = await db.person.findMany({ where: { id: { in: unique }, workspaceId }, select: { id: true } })
  const found = new Set(rows.map(row => row.id))
  const missing = unique.filter(id => !found.has(id))
  if (missing.length) throw notFound("Person not found", { ids: missing })
}

async function automaticPairPatch(keepId: string, deleteId: string, workspaceId: string) {
  const persons = await db.person.findMany({ where: { id: { in: [keepId, deleteId] }, workspaceId }, select: mergeSelect })
  const keeper = persons.find(person => person.id === keepId) as MergePerson | undefined
  const loser = persons.find(person => person.id === deleteId) as MergePerson | undefined
  if (!keeper || !loser) return {}
  return automaticPatch(keeper, loser)
}

function explicitPatch(fields: Record<string, unknown>) {
  const data: Record<string, unknown> = {}
  const scalars = [
    "first", "last", "title", "headline", "company",
    "location", "birthday", "closeness", "linkedin", "twitter",
    "website", "facebook", "instagram", "notes", "color", "colorSoft",
  ]
  for (const key of scalars) {
    if (key in fields) data[key] = fields[key] ?? null
  }
  if ("tags" in fields) data.tags = JSON.stringify(Array.isArray(fields.tags) ? fields.tags : [])
  if ("values" in fields) data.values = JSON.stringify(Array.isArray(fields.values) ? fields.values : [])
  if ("emails" in fields) data.emails = JSON.stringify(Array.isArray(fields.emails) ? [...new Set(fields.emails as string[])] : [])
  if ("phones" in fields) data.phones = JSON.stringify(Array.isArray(fields.phones) ? [...new Set(fields.phones as string[])] : [])
  return data
}

function automaticPatch(keeper: MergePerson, loser: MergePerson) {
  const patch: Record<string, unknown> = {}
  for (const key of ["title", "headline", "company", "location", "birthday", "linkedin", "twitter", "website", "facebook", "instagram"] as const) {
    if (!keeper[key] && loser[key]) patch[key] = loser[key]
  }

  if (!keeper.notes && loser.notes) {
    patch.notes = loser.notes
  } else if (keeper.notes && loser.notes && keeper.notes !== loser.notes) {
    patch.notes = `${keeper.notes}\n\n---\n${loser.notes}`
  }

  if (loser.closeness > keeper.closeness) patch.closeness = loser.closeness

  for (const field of ["emails", "phones", "tags", "values"] as const) {
    const existing = parseTags(keeper[field])
    const merged = [...existing]
    for (const value of parseTags(loser[field])) {
      if (!merged.includes(value)) merged.push(value)
    }
    if (merged.length > existing.length) patch[field] = JSON.stringify(merged)
  }

  return patch
}

function clusterPatch(keeper: MergePerson, losers: MergePerson[]) {
  let patch: Record<string, unknown> = {}
  for (const loser of losers) {
    patch = { ...patch, ...automaticPatch({ ...keeper, ...patch } as MergePerson, loser) }
  }
  return patch
}

async function applyMerge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  keepId: string,
  deleteId: string,
  patch: Record<string, unknown>,
  workspaceId: string,
) {
  if (Object.keys(patch).length > 0) {
    // updateMany (not update) so the workspace filter is enforced even if
    // keepId somehow slipped through an earlier check unscoped.
    await tx.person.updateMany({ where: { id: keepId, workspaceId }, data: patch })
  }
  await reassignAndDelete(tx, keepId, deleteId, workspaceId)
}

type ReassignHints = {
  interactions?: boolean
  plans?: boolean
  stagedCandidate?: boolean
  stagedAccepted?: boolean
  apiKeys?: boolean
  audits?: boolean
}

async function reassignAndDelete(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  keepId: string,
  deleteId: string,
  workspaceId: string,
  hints?: ReassignHints,
) {
  // Every reassignment and the final delete carry workspaceId in their WHERE
  // clause as defense-in-depth, even though callers already verified both
  // persons belong to this workspace before reaching here.
  if (hints?.interactions !== false) await tx.interaction.updateMany({ where: { personId: deleteId, workspaceId }, data: { personId: keepId } })
  if (hints?.plans !== false) await tx.plan.updateMany({ where: { personId: deleteId, workspaceId }, data: { personId: keepId } })
  if (hints?.stagedCandidate !== false) await tx.stagedInteraction.updateMany({ where: { candidatePersonId: deleteId, workspaceId }, data: { candidatePersonId: keepId } })
  if (hints?.stagedAccepted !== false) await tx.stagedInteraction.updateMany({ where: { acceptedPersonId: deleteId, workspaceId }, data: { acceptedPersonId: keepId } })
  if (hints?.apiKeys !== false) await tx.apiKey.updateMany({ where: { ownerPersonId: deleteId, workspaceId }, data: { ownerPersonId: keepId } })
  if (hints?.audits !== false) await tx.auditLog.updateMany({ where: { personId: deleteId, workspaceId }, data: { personId: keepId } })
  await tx.person.deleteMany({ where: { id: deleteId, workspaceId } })
}

function sortByKeepPreference(persons: MergePerson[]) {
  return [...persons].sort((a, b) =>
    b._count.interactions - a._count.interactions ||
    a.createdAt.getTime() - b.createdAt.getTime()
  )
}

function buildComponents(pairs: ClusterPairInput[]) {
  const parent: Record<string, string> = {}
  function find(value: string): string {
    if (!parent[value]) parent[value] = value
    if (parent[value] !== value) parent[value] = find(parent[value])
    return parent[value]
  }
  function union(a: string, b: string) {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootA] = rootB
  }

  for (const { aId, bId } of pairs) {
    if (aId && bId && aId !== bId) union(aId, bId)
  }

  const ids = new Set(pairs.flatMap(pair => [pair.aId, pair.bId]))
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const root = find(id)
    groups.set(root, [...(groups.get(root) ?? []), id])
  }
  return [...groups.values()].filter(group => group.length >= 2)
}

function findAutoMergePairs(all: MergePerson[]) {
  const deleted = new Set<string>()
  const toMerge: PairResult[] = []

  const byEmail = new Map<string, MergePerson[]>()
  for (const person of all) {
    for (const email of parseTags(person.emails)) {
      const key = email.toLowerCase().trim()
      if (!key) continue
      byEmail.set(key, [...(byEmail.get(key) ?? []), person])
    }
  }
  for (const bucket of byEmail.values()) {
    const [keeper, ...losers] = sortByKeepPreference(bucket)
    for (const loser of losers) {
      if (deleted.has(keeper.id) || deleted.has(loser.id)) continue
      toMerge.push(pairResult(keeper, loser, 1, "Same email address"))
      deleted.add(loser.id)
    }
  }

  const byPhone = new Map<string, MergePerson[]>()
  for (const person of all) {
    for (const phone of parseTags(person.phones)) {
      const digits = phone.replace(/\D/g, "")
      if (digits.length < 7) continue
      byPhone.set(digits, [...(byPhone.get(digits) ?? []), person])
    }
  }
  for (const bucket of byPhone.values()) {
    const [keeper, ...losers] = sortByKeepPreference(bucket)
    for (const loser of losers) {
      if (deleted.has(keeper.id) || deleted.has(loser.id)) continue
      toMerge.push(pairResult(keeper, loser, 0.97, "Same phone number"))
      deleted.add(loser.id)
    }
  }

  const byPrefix = new Map<string, MergePerson[]>()
  for (const person of all) {
    if (deleted.has(person.id)) continue
    // Block on last name when present, otherwise fall back to first name so
    // contacts whose full name lives in `first` still get compared.
    const blockName = norm(person.last || person.first)
    if (!blockName) continue
    const key = blockName.slice(0, 3).padEnd(3, "_")
    byPrefix.set(key, [...(byPrefix.get(key) ?? []), person])
  }
  for (const bucket of byPrefix.values()) {
    for (let i = 0; i < bucket.length; i++) {
      if (deleted.has(bucket[i].id)) continue
      for (let j = i + 1; j < bucket.length; j++) {
        // bucket[i] may have just been picked as the loser of a previous pair
        // in this inner loop — stop pairing it or the same person gets
        // scheduled for deletion twice.
        if (deleted.has(bucket[i].id)) break
        if (deleted.has(bucket[j].id)) continue
        const scored = scoreMinimal(bucket[i], bucket[j])
        if (!scored || scored.score < AUTO_THRESHOLD) continue
        const [keeper, loser] = pickKeeper(bucket[i], bucket[j])
        toMerge.push(pairResult(keeper, loser, scored.score, scored.reason))
        deleted.add(loser.id)
      }
    }
  }

  return toMerge
}

function pairResult(keeper: MergePerson, loser: MergePerson, score: number, reason: string): PairResult {
  return {
    keepId: keeper.id,
    deleteId: loser.id,
    score,
    reason,
    keepName: `${keeper.first} ${keeper.last}`,
    deleteName: `${loser.first} ${loser.last}`,
  }
}

function scoreMinimal(a: MergePerson, b: MergePerson) {
  const aEmails = parseTags(a.emails)
  const bEmails = parseTags(b.emails)
  if (aEmails.length && bEmails.length) {
    const bSet = new Set(bEmails.map(email => email.toLowerCase().trim()))
    if (aEmails.some(email => bSet.has(email.toLowerCase().trim()))) return { score: 1, reason: "Same email address" }
  }

  const aPhones = parseTags(a.phones).map(phone => phone.replace(/\D/g, "")).filter(phone => phone.length >= 7)
  const bPhones = parseTags(b.phones).map(phone => phone.replace(/\D/g, "")).filter(phone => phone.length >= 7)
  if (aPhones.length && bPhones.length) {
    const bSet = new Set(bPhones)
    if (aPhones.some(phone => bSet.has(phone))) return { score: 0.97, reason: "Same phone number" }
  }

  const nameSim = jaroWinkler(norm(`${a.first} ${a.last}`), norm(`${b.first} ${b.last}`))
  const sameCompany = Boolean(a.company && b.company && jaroWinkler(norm(a.company), norm(b.company)) > 0.85)
  if (nameSim >= 0.92) {
    return { score: Math.min(1, nameSim + (sameCompany ? 0.03 : 0)), reason: sameCompany ? "Similar name, same company" : "Very similar name" }
  }
  if (nameSim >= 0.82 && sameCompany) return { score: nameSim, reason: "Similar name, same company" }
  return null
}

function pickKeeper(a: MergePerson, b: MergePerson): [MergePerson, MergePerson] {
  if (a._count.interactions !== b._count.interactions) {
    return a._count.interactions > b._count.interactions ? [a, b] : [b, a]
  }
  return a.createdAt <= b.createdAt ? [a, b] : [b, a]
}

function jaro(s1: string, s2: string) {
  if (s1 === s2) return 1
  const l1 = s1.length
  const l2 = s2.length
  if (!l1 || !l2) return 0
  const md = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0)
  const m1 = new Array(l1).fill(false)
  const m2 = new Array(l2).fill(false)
  let matches = 0
  for (let i = 0; i < l1; i++) {
    for (let j = Math.max(0, i - md); j < Math.min(i + md + 1, l2); j++) {
      if (m2[j] || s1[i] !== s2[j]) continue
      m1[i] = true
      m2[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let transpositions = 0
  let k = 0
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue
    while (!m2[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }
  return (matches / l1 + matches / l2 + (matches - transpositions / 2) / matches) / 3
}

function jaroWinkler(a: string, b: string) {
  const score = jaro(a, b)
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }
  return score + prefix * 0.1 * (1 - score)
}

function norm(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "")
}

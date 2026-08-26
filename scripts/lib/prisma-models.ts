const SCALARS = new Set([
  "String",
  "Int",
  "Float",
  "Boolean",
  "DateTime",
  "Bytes",
  "Json",
  "Decimal",
  "BigInt",
])

export type PrismaModelColumns = Map<string, string[]>

const FIELD = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?/

/** Strip `//` comments that are not inside a string. Good enough for schema.prisma. */
export function stripPrismaComments(source: string): string {
  return source
    .split("\n")
    .map(line => {
      let inString = false
      for (let index = 0; index < line.length - 1; index++) {
        const char = line[index]
        if (char === '"') inString = !inString
        if (!inString && char === "/" && line[index + 1] === "/") {
          return line.slice(0, index)
        }
      }
      return line
    })
    .join("\n")
}

export function parsePrismaModels(schema: string): PrismaModelColumns {
  const body = stripPrismaComments(schema)
  const models: PrismaModelColumns = new Map()
  const modelPattern = /\bmodel\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g
  for (const match of body.matchAll(modelPattern)) {
    const name = match[1]
    const start = match.index! + match[0].length
    const end = findBlockEnd(body, start)
    if (end === -1) continue
    const columns: string[] = []
    for (const rawLine of body.slice(start, end).split("\n")) {
      const line = rawLine.trim()
      if (!line || line.startsWith("@@") || line.startsWith("@")) continue
      const field = FIELD.exec(line)
      if (!field) continue
      const [, column, type, list] = field
      if (list) continue
      if (!SCALARS.has(type)) continue
      columns.push(column)
    }
    models.set(name, columns)
  }
  return models
}

function findBlockEnd(source: string, from: number): number {
  let depth = 1
  for (let index = from; index < source.length; index++) {
    const char = source[index]
    if (char === "{") depth++
    if (char === "}") {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}

export type SchemaGap = {
  missingTables: string[]
  missingColumns: { table: string; column: string }[]
}

export function schemaGaps(models: PrismaModelColumns, live: PrismaModelColumns): SchemaGap {
  const missingTables: string[] = []
  const missingColumns: { table: string; column: string }[] = []
  for (const [table, columns] of models) {
    const liveColumns = live.get(table)
    if (!liveColumns) {
      missingTables.push(table)
      continue
    }
    const present = new Set(liveColumns)
    for (const column of columns) {
      if (!present.has(column)) missingColumns.push({ table, column })
    }
  }
  return { missingTables, missingColumns }
}

export function formatSchemaGaps(gap: SchemaGap): string {
  const lines: string[] = []
  for (const table of gap.missingTables) {
    lines.push(`missing table ${table}`)
  }
  for (const { table, column } of gap.missingColumns) {
    lines.push(`missing column ${table}.${column}`)
  }
  return lines.join("\n")
}

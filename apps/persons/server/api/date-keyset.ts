import { badRequest } from "./errors"

export type DateKeysetCursor = { date: Date; id: string }

export function encodeDateKeysetCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`, "utf8").toString("base64url")
}

export function decodeDateKeysetCursor(cursor: string): DateKeysetCursor {
  let decoded: string
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8")
  } catch {
    throw badRequest("cursor is not valid base64url", { field: "cursor" })
  }

  const separator = decoded.indexOf("|")
  const date = new Date(decoded.slice(0, separator))
  const id = decoded.slice(separator + 1)
  if (separator <= 0 || Number.isNaN(date.getTime()) || !id) {
    throw badRequest("cursor is malformed", { field: "cursor" })
  }

  return { date, id }
}

export function parsePageRequest(
  searchParams: URLSearchParams,
  defaults: { limit: number; maxLimit?: number },
) {
  const rawLimit = searchParams.get("limit")
  const parsedLimit = rawLimit === null || rawLimit === "" ? defaults.limit : Number(rawLimit)
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    throw badRequest("limit must be a positive integer", { field: "limit" })
  }

  const limit = Math.min(defaults.maxLimit ?? 500, parsedLimit)
  const rawCursor = searchParams.get("cursor")
  const cursor = rawCursor ? decodeDateKeysetCursor(rawCursor) : null
  return { cursor, limit }
}

export function dateKeysetSeek(
  field: "createdAt" | "timestamp",
  cursor: DateKeysetCursor,
  order: "asc" | "desc",
) {
  const comparator = order === "asc" ? "gt" : "lt"
  return {
    OR: [
      { [field]: { [comparator]: cursor.date } },
      { [field]: cursor.date, id: { [comparator]: cursor.id } },
    ],
  }
}

export function cursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  date: (row: T) => Date,
) {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data.at(-1)
  return {
    data,
    nextCursor: hasMore && last ? encodeDateKeysetCursor(date(last), last.id) : null,
    hasMore,
    limit,
  }
}

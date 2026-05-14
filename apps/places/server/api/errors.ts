export class AppError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = "AppError"
    this.status = status
    this.code = code
    this.details = details
  }
}

export function badRequest(message: string, details?: unknown) {
  return new AppError(400, "bad_request", message, details)
}

export function notFound(message: string, details?: unknown) {
  return new AppError(404, "not_found", message, details)
}

export function conflict(message: string, details?: unknown) {
  return new AppError(409, "conflict", message, details)
}

export function unauthorized(message = "Unauthorized", details?: unknown) {
  return new AppError(401, "unauthorized", message, details)
}

export function forbidden(message = "Forbidden", details?: unknown) {
  return new AppError(403, "forbidden", message, details)
}

export function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required`, { field })
  }
  return value.trim()
}

export function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null
}

export function optionalStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : []
}

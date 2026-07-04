import { NextResponse } from "next/server"
import { AppError } from "./errors"

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function created(data: unknown) {
  return NextResponse.json(data, { status: 201 })
}

export function noContent() {
  return new NextResponse(null, { status: 204 })
}

export function handleRouteError(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    }, { status: error.status })
  }

  console.error("[api] unhandled error", error)
  return NextResponse.json({
    error: {
      code: "internal_error",
      message: "Internal server error",
    },
  }, { status: 500 })
}

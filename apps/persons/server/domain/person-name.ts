import { optionalString, requiredString } from "../api/errors"

export function requiredFirstName(value: unknown): string {
  return requiredString(value, "first")
}

export function optionalLastName(value: unknown): string {
  return optionalString(value) ?? ""
}

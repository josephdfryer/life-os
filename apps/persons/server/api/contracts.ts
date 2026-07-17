import { contractIssues, type z } from "@life-os/contracts"
import { badRequest } from "./errors"

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const body = await request.json().catch(() => {
    throw badRequest("Request body must be valid JSON")
  })
  const result = schema.safeParse(body)
  if (!result.success) {
    throw badRequest("Request body failed validation", { issues: contractIssues(result.error) })
  }
  return result.data
}

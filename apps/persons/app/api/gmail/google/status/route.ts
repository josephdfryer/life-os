import { requireAccess } from "@/server/domain/access"
import { gmailStatus } from "@/server/domain/gmail"
import { handleRouteError, json } from "@/server/api/respond"

export async function GET() {
  try {
    const actor = await requireAccess("interactions.write")
    return json(await gmailStatus(actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

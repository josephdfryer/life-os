import { requireAccess } from "@/server/domain/access"
import { importGmailContactsPreview } from "@/server/domain/gmail"
import { handleRouteError, json } from "@/server/api/respond"

export async function GET() {
  try {
    const actor = await requireAccess("people.write")
    return json(await importGmailContactsPreview(actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

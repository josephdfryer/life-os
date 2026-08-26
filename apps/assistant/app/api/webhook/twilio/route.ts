import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { validateTwilioSignature, isAllowedSender, twimlReply, twimlEmpty, sendWhatsApp } from "@/lib/twilio"
import { runAgent } from "@/lib/agent"
import { db } from "@/lib/db"

export const maxDuration = 300

// Twilio webhooks carry no LifeOS session — the trust boundary here is the
// Twilio signature plus the MY_WHATSAPP_NUMBER allowlist, not a workspace
// membership lookup. This deployment's single owner workspace is fixed via
// env, unlike the session-authenticated web chat route.
const WORKSPACE_ID = process.env.LIFE_OS_WORKSPACE_ID ?? "default-workspace"

export async function POST(req: NextRequest) {
  const url = req.url
  const signature = req.headers.get("x-twilio-signature") ?? ""

  const formData = await req.formData()
  const params: Record<string, string> = {}
  formData.forEach((value, key) => {
    params[key] = value.toString()
  })

  if (!validateTwilioSignature(url, params, signature)) {
    console.error("Twilio signature validation failed", {
      url,
      hasSignature: Boolean(signature),
      hasAuthToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
    })
    return new NextResponse("Forbidden", { status: 403 })
  }

  const from = params["From"] ?? ""
  const to = params["To"] ?? "" // our WhatsApp number — reused as outbound sender
  const body = (params["Body"] ?? "").trim()

  if (!isAllowedSender(from)) {
    console.error("Sender not allowed", { from, hasMyNumber: Boolean(process.env.MY_WHATSAPP_NUMBER) })
    return new NextResponse("Forbidden", { status: 403 })
  }

  if (!body) {
    return xml(twimlReply("Got an empty message — try again."))
  }

  // Fast path: "note: ..." / "n: ..." captures directly, no model round-trip.
  const noteMatch = body.match(/^(?:note|n):\s*([\s\S]+)$/i)
  if (noteMatch) {
    const content = noteMatch[1].trim()
    await db.note.create({
      data: {
        workspaceId: WORKSPACE_ID,
        timestamp: new Date(),
        type: "thought",
        content,
        metadata: JSON.stringify({ source: "whatsapp" }),
      },
    })
    return xml(twimlReply(`Noted ✓ "${content.slice(0, 60)}${content.length > 60 ? "…" : ""}"`))
  }

  // Agentic runs can take longer than Twilio's webhook window: ack now with
  // an empty TwiML response, then reply out-of-band via the REST API.
  after(async () => {
    try {
      const { reply } = await runAgent({ channel: "whatsapp", from, userMessage: body, workspaceId: WORKSPACE_ID })
      await sendWhatsApp(from, to, reply)
    } catch (err) {
      console.error("Agent run failed:", err)
      await sendWhatsApp(from, to, "Something went wrong on my end. Try again in a moment.").catch(() => {})
    }
  })

  return xml(twimlEmpty())
}

function xml(body: string) {
  return new NextResponse(body, { headers: { "Content-Type": "text/xml" } })
}

import { NextRequest, NextResponse } from "next/server"
import { validateTwilioSignature, isAllowedSender, twimlReply } from "@/lib/twilio"
import { callClaude } from "@/lib/claude"

export async function POST(req: NextRequest) {
  const url = req.url
  const signature = req.headers.get("x-twilio-signature") ?? ""

  const formData = await req.formData()
  const params: Record<string, string> = {}
  formData.forEach((value, key) => {
    params[key] = value.toString()
  })

  if (!validateTwilioSignature(url, params, signature)) {
    return new NextResponse("Forbidden", { status: 403 })
  }

  const from = params["From"] ?? ""
  const body = (params["Body"] ?? "").trim()

  if (!isAllowedSender(from)) {
    return new NextResponse("Forbidden", { status: 403 })
  }

  if (!body) {
    return new NextResponse(twimlReply("Got an empty message — try again."), {
      headers: { "Content-Type": "text/xml" },
    })
  }

  try {
    const reply = await callClaude(from, body)
    return new NextResponse(twimlReply(reply), {
      headers: { "Content-Type": "text/xml" },
    })
  } catch (err) {
    console.error("Claude call failed:", err)
    return new NextResponse(twimlReply("Something went wrong. Try again in a moment."), {
      headers: { "Content-Type": "text/xml" },
    })
  }
}

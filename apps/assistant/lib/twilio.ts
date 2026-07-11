import twilio from "twilio"

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? ""
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? ""
const MY_NUMBER = process.env.MY_WHATSAPP_NUMBER ?? ""

export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  return twilio.validateRequest(AUTH_TOKEN, signature, url, params)
}

export function isAllowedSender(from: string): boolean {
  if (!MY_NUMBER) return false
  // MY_WHATSAPP_NUMBER can be stored with or without "whatsapp:" prefix
  const normalized = MY_NUMBER.startsWith("whatsapp:") ? MY_NUMBER : `whatsapp:${MY_NUMBER}`
  return from === normalized
}

export function twimlReply(message: string): string {
  const client = new twilio.twiml.MessagingResponse()
  client.message(message)
  return client.toString()
}

export function twimlEmpty(): string {
  return new twilio.twiml.MessagingResponse().toString()
}

// Outbound send via REST — used for async replies after the webhook has
// already returned (agentic runs exceed Twilio's webhook timeout).
export async function sendWhatsApp(to: string, from: string, body: string): Promise<void> {
  const client = twilio(ACCOUNT_SID, AUTH_TOKEN)
  // WhatsApp caps message length; split long replies into a few chunks.
  const chunks = splitMessage(body, 1500).slice(0, 3)
  for (const chunk of chunks) {
    await client.messages.create({ to, from, body: chunk })
  }
}

function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > 0) {
    if (rest.length <= max) {
      chunks.push(rest)
      break
    }
    let cut = rest.lastIndexOf("\n", max)
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max)
    if (cut < max * 0.5) cut = max
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).trimStart()
  }
  return chunks
}

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

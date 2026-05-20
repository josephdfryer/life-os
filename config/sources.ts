export const sources = {
  imessage: process.env.ENABLE_IMESSAGE !== "false",
  whatsapp: process.env.ENABLE_WHATSAPP !== "false",
  calls: process.env.ENABLE_CALLS !== "false",
  gmail: process.env.ENABLE_GMAIL !== "false",
  calendar: process.env.ENABLE_CALENDAR !== "false",
}

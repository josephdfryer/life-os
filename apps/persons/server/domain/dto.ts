import { parseTags } from "@/lib/utils"
import { centsToDollars } from "@life-os/db"

type JsonListRecord = {
  tags?: string | string[] | null
  values?: string | string[] | null
  emails?: string | string[] | null
  phones?: string | string[] | null
  actionItems?: string | string[] | null
  successSignals?: string | string[] | null
}

export function formatPerson<T extends JsonListRecord>(person: T) {
  return {
    ...person,
    tags: parseTags(person.tags),
    values: parseTags(person.values),
    emails: parseTags(person.emails),
    phones: parseTags(person.phones),
  }
}

export function formatInteraction<T extends JsonListRecord & { amount?: number | null }>(interaction: T) {
  return {
    ...interaction,
    actionItems: parseTags(interaction.actionItems),
    ...("amount" in interaction ? { amount: centsToDollars(interaction.amount) } : {}),
  }
}

export function formatPlan<T extends JsonListRecord>(plan: T) {
  return {
    ...plan,
    successSignals: parseTags(plan.successSignals),
  }
}

export function jsonList(value: string[]) {
  return JSON.stringify(value)
}

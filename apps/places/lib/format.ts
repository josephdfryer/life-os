const DATE_LOCALE = "en-US"
const DATE_TIME_ZONE = "America/Los_Angeles"

const dateFormatter = new Intl.DateTimeFormat(DATE_LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: DATE_TIME_ZONE,
})

const monthYearFormatter = new Intl.DateTimeFormat(DATE_LOCALE, {
  month: "long",
  year: "numeric",
  timeZone: DATE_TIME_ZONE,
})

const currencyFormatter = new Intl.NumberFormat(DATE_LOCALE, {
  style: "currency",
  currency: "USD",
})

const roundedCurrencyFormatter = new Intl.NumberFormat(DATE_LOCALE, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const integerFormatter = new Intl.NumberFormat(DATE_LOCALE)

export function formatDate(value: string) {
  return dateFormatter.format(new Date(value))
}

export function formatMonthYear(value: string) {
  return monthYearFormatter.format(new Date(value))
}

export function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

export function formatRoundedCurrency(value: number) {
  return roundedCurrencyFormatter.format(value)
}

export function formatInteger(value: number) {
  return integerFormatter.format(value)
}

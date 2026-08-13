// Moved to @life-os/alignment so the birthday-today alignment signal (Home's
// Nudges widget, Persons' Needs Attention list) and Persons' own display
// logic share one definition. Re-exported here so every existing import site
// keeps working unmodified.
export { normalizeBirthday, birthdayMonthDay } from "@life-os/alignment/pure"

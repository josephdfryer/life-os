// Client-safe entry point — pure scoring only, zero I/O, zero @life-os/db
// import anywhere in this module's graph. Import this (not the package root)
// from client components or anywhere else that must never bundle a DB driver.

export { relationshipGapScore, daysSince } from "./src/scoring"
export {
  normalizeBirthday,
  birthdayMonthDay,
  formatBirthday,
  daysUntilBirthday,
  isBirthdayToday,
  isBirthdayThisWeek,
  birthdayTurningAge,
} from "./src/birthday"

const PALETTE = [
  { color: "#c4572a", colorSoft: "#f5ede8" },
  { color: "#2a6ea3", colorSoft: "#e8f1f8" },
  { color: "#3a8a5c", colorSoft: "#e8f4ed" },
  { color: "#7a3aa3", colorSoft: "#f0e8f8" },
  { color: "#a38a3a", colorSoft: "#f8f4e8" },
  { color: "#3a7aa3", colorSoft: "#e8f3f8" },
  { color: "#a33a6e", colorSoft: "#f8e8f1" },
  { color: "#5c8a3a", colorSoft: "#edf4e8" },
]

export function assignColor(index: number) {
  return PALETTE[index % PALETTE.length]
}

export function initials(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase()
}

export { PALETTE }

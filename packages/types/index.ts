// ─────────────────────────────────────────────
// PRIMARY: Person
// ─────────────────────────────────────────────

export type Person = {
  id: string
  createdAt: Date
  updatedAt: Date
  first: string
  last: string
  headline: string | null
  email: string | null
  phone: string | null
  birthday: string | null
  closeness: number
  tags: string[]
  values: string[]
  notes: string | null
  company: string | null
  location: string | null
  linkedin: string | null
  twitter: string | null
  website: string | null
  facebook: string | null
  instagram: string | null
  color: string | null
  colorSoft: string | null
}

export type PersonWithInteractions = Person & {
  interactions: Interaction[]
}

// For attention scoring
export type PersonWithAttention = Person & {
  interactions: Interaction[]
  attentionScore: number
  lastInteractionDate: Date | null
  daysSinceLast: number | null
}

// ─────────────────────────────────────────────
// PRIMARY: Event
// ─────────────────────────────────────────────

export type Event = {
  id: string
  createdAt: Date
  name: string
  type: string
  timestamp: Date
  placeId: string | null
  notes: string | null
  transcript: string | null
  metadata: Record<string, unknown> | null
}

// ─────────────────────────────────────────────
// PRIMARY: Interaction (universal linker)
// personId is optional — interactions can span any combination of primaries
// ─────────────────────────────────────────────

export type Interaction = {
  id: string
  createdAt: Date
  personId: string | null
  eventId: string | null
  event: Event | null
  placeId: string | null
  place: Place | null
  type: string
  timestamp: Date
  duration: number | null
  emotionalWeight: string | null
  outcome: string | null
  summary: string | null
  notes: string | null
  actionItems: string[] | null
  billable: boolean
  amount: number | null
  direction: string | null
  sourceFileId: string | null
  sourceFile: ImportedFile | null
}

// ─────────────────────────────────────────────
// PRIMARY: Plan
// ─────────────────────────────────────────────

export type Plan = {
  id: string
  createdAt: Date
  personId: string | null
  text: string
  timescale: string | null
  successSignals: string[] | null
  status: string
  parentId: string | null
  children: Plan[]
}

// ─────────────────────────────────────────────
// PRIMARY: Place (hierarchical locations)
// ─────────────────────────────────────────────

export type Place = {
  id: string
  name: string
  type: string | null
  address: string | null
  coordinates: { lat: number; lng: number } | null
  meaning: string | null
  parentPlaceId: string | null
}

export type PlaceWithChildren = Place & {
  childPlaces: Place[]
  parentPlace: Place | null
}

// ─────────────────────────────────────────────
// PRIMARY: Item (anything physical you own)
// ─────────────────────────────────────────────

export type Item = {
  id: string
  createdAt: Date
  updatedAt: Date
  name: string
  description: string | null
  category: string | null
  make: string | null
  model: string | null
  serialNumber: string | null
  assetId: string
  quantity: number
  purchaseDate: Date | null
  purchasePrice: number | null
  purchaseFrom: string | null
  warrantyExpires: Date | null
  lifetimeWarranty: boolean
  warrantyDetails: string | null
  // null when assembled inside another item — location is inherited
  placeId: string | null
  ownedById: string | null
  tags: string[] | null
  notes: string | null
  color: string | null
  colorSoft: string | null
}

export type ItemWithAssembly = Item & {
  place: Place | null
  assembledInto: Assembly[]   // current parent (filter disassembledAt === null)
  components: Assembly[]      // current children (filter disassembledAt === null)
}

// ─────────────────────────────────────────────
// STRUCTURAL: Assembly
// Records that one item is (or was) inside another.
// disassembledAt = null means currently installed.
// ─────────────────────────────────────────────

export type Assembly = {
  id: string
  createdAt: Date
  childItemId: string
  parentItemId: string
  assembledAt: Date
  assembledById: string | null
  disassembledAt: Date | null
  disassembledById: string | null
  notes: string | null
}

export type AssemblyWithItems = Assembly & {
  childItem: Item
  parentItem: Item
}

// ─────────────────────────────────────────────
// JUNCTION: ItemInteraction
// ─────────────────────────────────────────────

export type ItemInteraction = {
  itemId: string
  interactionId: string
  role: string | null  // "subject" | "target" | "context"
}

// ─────────────────────────────────────────────
// SUPPORT: ImportedFile
// ─────────────────────────────────────────────

export type ImportedFile = {
  id: string
  createdAt: Date
  filename: string
  format: string
  filePath: string
  sizeBytes: number
}

// ─────────────────────────────────────────────
// Import helpers (persons app)
// ─────────────────────────────────────────────

export type ImportedPerson = {
  name: string
  isNew: boolean
  needsReview: boolean
  guessedHeadline: string | null
  guessedTags: string[]
  guessedCloseness: number
  closenessReason: string
  interactions: ImportedInteraction[]
  matchedPersonId: string | null
  matchedPersonName: string | null
}

export type ImportedInteraction = {
  eventType: string
  date: string
  summary: string
  emotionalWeight: string
  outcome: string
  keyTopics: string[]
}

export type ClosenessLevel = 1 | 2 | 3 | 4

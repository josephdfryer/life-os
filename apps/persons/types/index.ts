export type Person = {
  id: string
  createdAt: Date
  updatedAt: Date
  first: string
  last: string
  nickname: string | null
  title: string | null
  headline: string | null
  emails: string[]
  phones: string[]
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
  publicProfileEnabled: boolean
  publicSlug: string | null
  source: string | null
}

export type PersonWithInteractions = Person & {
  interactions: Interaction[]
}

export type HealthMetricPoint = {
  key: string
  label: string
  value: number
  unit: string
}

export type HealthDailyLogEntry = {
  id: string
  date: string
  content: string
}

export type PersonHealthSummary = {
  latestDate: string
  metrics: HealthMetricPoint[]
  recentLog: HealthDailyLogEntry[]
  totalReadings: number
}

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

export type Interaction = {
  id: string
  createdAt: Date
  personId: string
  eventId: string | null
  event: Event | null
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

export type Place = {
  id: string
  name: string
  type: string | null
  address: string | null
  coordinates: { lat: number; lng: number } | null
  meaning: string | null
}

export type ImportedFile = {
  id: string
  createdAt: Date
  filename: string
  format: string
  filePath: string
  sizeBytes: number
}

// For attention scoring
export type PersonWithAttention = Person & {
  interactions: Interaction[]
  attentionScore: number
  lastInteractionDate: Date | null
  daysSinceLast: number | null
  health?: PersonHealthSummary | null
}

export type PersonListPerson = Omit<PersonWithAttention, "createdAt" | "updatedAt" | "lastInteractionDate"> & {
  createdAt: string
  updatedAt: string
  lastInteractionDate: string | null
  latestInteraction: {
    id: string
    type: string
    source: string | null
    timestamp: string
    summary: string | null
  } | null
  activePlan: {
    id: string
    text: string
    dueOn: string | null
  } | null
}

// Import types
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

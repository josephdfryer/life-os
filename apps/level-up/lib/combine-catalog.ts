import { CATALOG_BY_ATTRIBUTE, ATTRIBUTE_LABELS, ATTRIBUTE_ORDER } from "@life-os/level-up"

// Serializable catalog metadata for the combine + cold-start forms. The gate
// protocol flags are surfaced as toggles so the data-quality requirement reads
// as a quest ("Complete the Reactive Cut Test to unlock 80+"), not a wall.

export type ProtocolOption = { flag: string; label: string }

const PROTOCOL_OPTIONS: Record<string, ProtocolOption[]> = {
  flying10_velocity: [{ flag: "120fps", label: "120 fps / electronic timing (unlocks 82+)" }],
  vertical_cmj: [{ flag: "force-plate", label: "Force plate / validated app (unlocks 85+)" }],
  trap_bar_dl: [{ flag: "video-verified", label: "Full-ROM, video verified (unlocks 82+)" }],
  vo2max: [{ flag: "wearable", label: "Wearable estimate (caps Engine at 81)" }],
}

export type CombineTestMeta = {
  key: string
  label: string
  unit: string
  relative: boolean
  note?: string
  protocolOptions: ProtocolOption[]
}

export type CombineGroup = { attribute: string; label: string; tests: CombineTestMeta[] }

export const COMBINE_GROUPS: CombineGroup[] = ATTRIBUTE_ORDER.filter((a) => a !== "resilience").map((attribute) => ({
  attribute,
  label: ATTRIBUTE_LABELS[attribute],
  tests: (CATALOG_BY_ATTRIBUTE[attribute] ?? []).map((d) => ({
    key: d.key,
    label: d.label,
    unit: d.unit,
    relative: !!d.relative,
    note: d.note,
    protocolOptions: PROTOCOL_OPTIONS[d.key] ?? [],
  })),
}))

export const RELATIVE_KEYS = new Set(
  COMBINE_GROUPS.flatMap((g) => g.tests.filter((t) => t.relative).map((t) => t.key)),
)

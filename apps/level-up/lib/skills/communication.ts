export const COMMUNICATION_SKILL = {
  key: "communication",
  label: "Communication",
  blurb: "How clearly I speak and write when it matters.",
  tracks: [
    {
      key: "public_speaking",
      label: "Public speaking",
      blurb: "Live rooms, talks, presentations, hard conversations out loud.",
    },
    {
      key: "written_communication",
      label: "Written communication",
      blurb: "Email, docs, and follow-through in writing.",
    },
  ],
} as const

export type CommunicationTrackKey = (typeof COMMUNICATION_SKILL.tracks)[number]["key"]

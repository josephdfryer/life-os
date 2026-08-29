import { memo, useMemo } from "react"
import Link from "next/link"
import PersonAvatar from "./PersonAvatar"
import { closenessLabel, relativeTime } from "@/lib/utils"
import {
  interactionSourceLabel,
  personContext,
  personSourceBadge,
  relationshipStatus,
} from "@/lib/person-list-presentation"
import type { PersonListPerson } from "@/types"
import styles from "./PersonCard.module.css"

type Props = {
  person: PersonListPerson
}

function PersonCard({ person }: Props) {
  const status = useMemo(() => relationshipStatus(person), [person])
  const context = useMemo(() => personContext(person), [person])
  const latest = person.latestInteraction
  const interactionMeta = useMemo(() => 
    latest
      ? `${interactionSourceLabel(latest.source, latest.type)} · ${relativeTime(latest.timestamp)}`
      : "No interaction history",
    [latest]
  )
  const firstTag = person.tags[0]
  const sourceBadge = useMemo(() => personSourceBadge(person.source), [person.source])

  return (
    <Link
      href={`/persons/${person.id}`}
      className={styles.card}
      aria-label={`Open ${person.first} ${person.last}`}
    >
      <PersonAvatar
        first={person.first}
        last={person.last}
        color={person.color}
        colorSoft={person.colorSoft}
      />

      <div className={styles.identity}>
        <div className={styles.nameLine}>
          <span className={styles.name}>{person.first} {person.last}</span>
          {sourceBadge ? <span className={styles.sourceBadge} title={sourceBadge.label} aria-label={sourceBadge.label}>{sourceBadge.icon}</span> : null}
          <span className={styles.closeness}>{closenessLabel(person.closeness)}</span>
          {firstTag ? <span className={styles.tag}>{firstTag}</span> : null}
        </div>
        <span className={context === "No context yet · Add details" ? styles.emptyContext : styles.context}>
          {context}
        </span>
      </div>

      <div className={styles.relationship}>
        <span className={styles.interactionMeta}>{interactionMeta}</span>
        <span className={`${styles.status} ${styles[status.tone]}`} title={status.detail ?? undefined}>
          {status.label}
          {status.detail ? <span className={styles.statusDetail}> · {status.detail}</span> : null}
        </span>
      </div>

      <span className={styles.openHint} aria-hidden="true">›</span>
    </Link>
  )
}

// Memoize to prevent unnecessary re-renders in long lists
export default memo(PersonCard, (prev, next) => {
  // Only re-render if the person data actually changed
  return prev.person.id === next.person.id &&
    prev.person.updatedAt === next.person.updatedAt &&
    prev.person.attentionScore === next.person.attentionScore &&
    prev.person.daysSinceLast === next.person.daysSinceLast
})

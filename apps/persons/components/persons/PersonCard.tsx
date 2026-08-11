import Link from "next/link"
import PersonAvatar from "./PersonAvatar"
import { closenessLabel, relativeTime } from "@/lib/utils"
import {
  interactionSourceLabel,
  personContext,
  relationshipStatus,
} from "@/lib/person-list-presentation"
import type { PersonListPerson } from "@/types"
import styles from "./PersonCard.module.css"

type Props = {
  person: PersonListPerson
}

export default function PersonCard({ person }: Props) {
  const status = relationshipStatus(person)
  const context = personContext(person)
  const latest = person.latestInteraction
  const interactionMeta = latest
    ? `${interactionSourceLabel(latest.source, latest.type)} · ${relativeTime(latest.timestamp)}`
    : "No interaction history"
  const firstTag = person.tags[0]

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

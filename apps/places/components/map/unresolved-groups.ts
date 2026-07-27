export type UnresolvedObservation = {
  id: string
  latitude: number
  longitude: number
  startedAt: string
  placeName?: string
  placeAddress?: string
  aiEnrichment?: { placeName: string }
}

export type UnresolvedObservationGroup<T extends UnresolvedObservation> = {
  id: string
  representative: T
  observations: T[]
  label: string
  latitude: number
  longitude: number
}

const GROUP_RADIUS_METERS = 75

export function groupUnresolvedObservations<T extends UnresolvedObservation>(observations: T[]) {
  const groups: Array<UnresolvedObservationGroup<T>> = []
  for (const observation of observations) {
    const label = observationLabel(observation)
    const group = groups.find(candidate =>
      normalized(candidate.label) === normalized(label) &&
      distanceMeters(candidate.latitude, candidate.longitude, observation.latitude, observation.longitude) <= GROUP_RADIUS_METERS
    )
    if (group) {
      group.observations.push(observation)
      group.latitude = average(group.observations.map(item => item.latitude))
      group.longitude = average(group.observations.map(item => item.longitude))
      if (new Date(observation.startedAt) > new Date(group.representative.startedAt)) {
        group.representative = observation
      }
      continue
    }
    groups.push({
      id: observation.id,
      representative: observation,
      observations: [observation],
      label,
      latitude: observation.latitude,
      longitude: observation.longitude,
    })
  }
  return groups.toSorted((a, b) =>
    b.observations.length - a.observations.length ||
    new Date(b.representative.startedAt).getTime() - new Date(a.representative.startedAt).getTime()
  )
}

function observationLabel(observation: UnresolvedObservation) {
  return observation.aiEnrichment?.placeName ?? observation.placeName ?? observation.placeAddress ?? "Unresolved visit"
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase()
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function distanceMeters(latA: number, lngA: number, latB: number, lngB: number) {
  const radians = Math.PI / 180
  const dLat = (latB - latA) * radians
  const dLng = (lngB - lngA) * radians
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * radians) * Math.cos(latB * radians) * Math.sin(dLng / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

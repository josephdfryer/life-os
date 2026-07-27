import { notFound, redirect } from "next/navigation"
import { lifeOsAppUrl } from "@life-os/auth"
import { AppError } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import { getPlaceProfile, getPlacesForMap } from "@/server/domain/places"
import { explorerStateFromParams, filterAndSortPlaces } from "@/components/map/explorer-state"
import PlaceProfileClient from "./PlaceProfileClient"

export const dynamic = "force-dynamic"

export default async function PlaceProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { id } = await params
  try {
    const actor = await requireAccess("places.read")
    const { from } = await searchParams
    const [profile, mapPlaces] = await Promise.all([
      getPlaceProfile(id, actor.workspaceId),
      from ? getPlacesForMap(actor.workspaceId) : Promise.resolve([]),
    ])
    const navigation = from ? profileNavigation(id, from, mapPlaces) : null
    return (
      <PlaceProfileClient
        initialProfile={profile as never}
        navigation={navigation}
        appUrls={{
          persons: lifeOsAppUrl("persons", "http://localhost:3000"),
          events: lifeOsAppUrl("events", "http://localhost:3006"),
        }}
      />
    )
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect(`/login?callbackUrl=%2Fplaces%2F${encodeURIComponent(id)}`)
    }
    if (error instanceof AppError && error.status === 404) {
      notFound()
    }
    if (error instanceof AppError && error.status === 403) {
      return <AccessDenied />
    }
    throw error
  }
}

function profileNavigation(
  currentId: string,
  from: string,
  places: Awaited<ReturnType<typeof getPlacesForMap>>,
) {
  const state = explorerStateFromParams(new URLSearchParams(from))
  const ordered = filterAndSortPlaces(places, { ...state, selectedId: null })
  const index = ordered.findIndex(place => place.id === currentId)
  if (index < 0) return null
  const href = (place: typeof ordered[number] | undefined) => place
    ? `/places/${place.id}?from=${encodeURIComponent(from)}`
    : null
  return {
    position: index + 1,
    total: ordered.length,
    previous: ordered[index - 1] ? { name: ordered[index - 1].name, href: href(ordered[index - 1])! } : null,
    next: ordered[index + 1] ? { name: ordered[index + 1].name, href: href(ordered[index + 1])! } : null,
  }
}

function AccessDenied() {
  return (
    <main className="places-route-state">
      <span aria-hidden="true">◇</span>
      <h1>This Place is outside your workspace access</h1>
      <p>Your data is unchanged. Ask a workspace owner for Places access or return to the map.</p>
      <a href="/places">Return to Places</a>
    </main>
  )
}

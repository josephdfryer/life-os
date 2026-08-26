export const LIFE_OS_ROOT_DOMAIN = 'lacollecteur.com'

export const LIFE_OS_APP_URLS = {
  home: `https://home.${LIFE_OS_ROOT_DOMAIN}`,
  persons: `https://persons.${LIFE_OS_ROOT_DOMAIN}`,
  events: `https://events.${LIFE_OS_ROOT_DOMAIN}`,
  places: `https://places.${LIFE_OS_ROOT_DOMAIN}`,
  stuff: `https://stuff.${LIFE_OS_ROOT_DOMAIN}`,
  assistant: `https://assistant.${LIFE_OS_ROOT_DOMAIN}`,
  levelUp: `https://level-up.${LIFE_OS_ROOT_DOMAIN}`,
} as const

export type LifeOSAppKey = keyof typeof LIFE_OS_APP_URLS

export type LifeOSAppEntry = {
  key: LifeOSAppKey
  label: string
  url: string
  localUrl: string
  /**
   * The app's identity color, used to tint its mark in shared chrome.
   * Every value is a Still token — the old ad-hoc blues, greens, and the
   * retired Warm Concrete terracotta are gone. Do not add a color here that
   * is not in `docs/STILL_DESIGN_SYSTEM.md`.
   */
  accent: string
  blurb: string
}

export const LIFE_OS_APPS: readonly LifeOSAppEntry[] = [
  { key: 'home', label: 'Home', url: LIFE_OS_APP_URLS.home, localUrl: 'http://localhost:3003', accent: '#6e5238', blurb: 'Your daily overview' },
  { key: 'persons', label: 'Persons', url: LIFE_OS_APP_URLS.persons, localUrl: 'http://localhost:3000', accent: '#8f6b4a', blurb: 'People & relationships' },
  { key: 'events', label: 'Events', url: LIFE_OS_APP_URLS.events, localUrl: 'http://localhost:3006', accent: '#524a42', blurb: 'Calendar & plans' },
  { key: 'places', label: 'Places', url: LIFE_OS_APP_URLS.places, localUrl: 'http://localhost:3002', accent: '#6b7a63', blurb: 'Your map of memory' },
  { key: 'stuff', label: 'Stuff', url: LIFE_OS_APP_URLS.stuff, localUrl: 'http://localhost:3001', accent: '#c4a574', blurb: 'Everything you own' },
  { key: 'assistant', label: 'Assistant', url: LIFE_OS_APP_URLS.assistant, localUrl: 'http://localhost:3005', accent: '#1a2a35', blurb: 'Chat & actions' },
  { key: 'levelUp', label: 'Level Up', url: LIFE_OS_APP_URLS.levelUp, localUrl: 'http://localhost:3010', accent: '#b07d4f', blurb: 'IRL player ratings' },
]

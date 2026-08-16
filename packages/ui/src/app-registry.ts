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
  dot: string
  blurb: string
}

export const LIFE_OS_APPS: readonly LifeOSAppEntry[] = [
  { key: 'home', label: 'Home', url: LIFE_OS_APP_URLS.home, localUrl: 'http://localhost:3003', dot: '#8a7a66', blurb: 'Your daily overview' },
  { key: 'persons', label: 'Persons', url: LIFE_OS_APP_URLS.persons, localUrl: 'http://localhost:3000', dot: '#b5835a', blurb: 'People & relationships' },
  { key: 'events', label: 'Events', url: LIFE_OS_APP_URLS.events, localUrl: 'http://localhost:3006', dot: '#6a8caf', blurb: 'Calendar & plans' },
  { key: 'places', label: 'Places', url: LIFE_OS_APP_URLS.places, localUrl: 'http://localhost:3002', dot: '#6f9a7b', blurb: 'Your map of memory' },
  { key: 'stuff', label: 'Stuff', url: LIFE_OS_APP_URLS.stuff, localUrl: 'http://localhost:3001', dot: '#a98a5c', blurb: 'Everything you own' },
  { key: 'assistant', label: 'Assistant', url: LIFE_OS_APP_URLS.assistant, localUrl: 'http://localhost:3005', dot: '#c08b6f', blurb: 'Chat & actions' },
  { key: 'levelUp', label: 'Level Up', url: LIFE_OS_APP_URLS.levelUp, localUrl: 'http://localhost:3010', dot: '#c4522a', blurb: 'IRL player ratings' },
]

#!/usr/bin/env node
// Generates every app's favicon, Safari home-screen icon, and native iOS
// AppIcon catalog from the canonical brand marks in packages/ui/brand/marks.
//
//   node scripts/brand/build-icons.mjs
//
// Marks are authored once, as `currentColor` geometry on a 100×100 grid. This
// script is the only place a mark ever gets a hard-coded color or a background
// tile, so a mark revision propagates to all seven web apps and both iPhone
// apps by re-running it.
// Output is committed — the apps must not depend on this script at build time.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MARKS = join(ROOT, 'packages', 'ui', 'brand', 'marks')

// Still tokens. Keep in sync with packages/ui/src/app-registry.ts.
const CREAM = '#f7f4ee'
const PETROL = '#1a2a35'
const CAMEL = '#c4a574'

/**
 * `ground: 'cream'` gives a light tile with the accent mark — the default,
 * and what reads best in a browser tab. Level Up runs a dark app shell, so it
 * takes the petrol tile with a camel mark instead.
 */
const APPS = [
  { dir: 'home', mark: 'life-os-mark-favicon', accent: '#6e5238', ground: 'cream' },
  { dir: 'persons', mark: 'life-os-persons', accent: '#8f6b4a', ground: 'cream' },
  { dir: 'places', mark: 'life-os-places', accent: '#6b7a63', ground: 'cream' },
  { dir: 'stuff', mark: 'life-os-stuff', accent: '#8f6b4a', ground: 'cream' },
  { dir: 'events', mark: 'life-os-events', accent: '#524a42', ground: 'cream' },
  { dir: 'assistant', mark: 'life-os-assistant', accent: '#1a2a35', ground: 'cream' },
  { dir: 'level-up', mark: 'life-os-level-up', accent: CAMEL, ground: 'petrol' },
]

/**
 * Native iPhone shells. These ship as real App Store / sideload binaries, so
 * the canvas is a full square — iOS applies the squircle mask. Do not round
 * the corners here. Light matches the web apple-icon; dark is the petrol
 * tile already authored in packages/ui/brand/tiles.
 */
const NATIVE_IOS = [
  {
    folder: join(ROOT, 'apps', 'companion', 'LifeOSCompanionIOS'),
    mark: 'life-os-mark',
    accent: '#6e5238',
  },
  {
    folder: join(ROOT, 'apps', 'companion', 'PersonsIOS'),
    mark: 'life-os-persons',
    accent: '#8f6b4a',
  },
]

/** Pulls the drawing instructions out of a mark file, dropping its <svg> shell. */
async function readMarkBody(name) {
  const raw = await readFile(join(MARKS, `${name}.svg`), 'utf8')
  const body = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  if (!body.trim()) throw new Error(`no geometry found in ${name}.svg`)
  return body.trim()
}

/**
 * Composes a mark onto a tile at an arbitrary size. The mark occupies the
 * middle half of the tile, which is the clear space the brief specifies and
 * which keeps the glyph clear of the iOS mask on every device.
 *
 * `corners: 'round'` approximates the iOS squircle for Safari "Add to Home
 * Screen" and browser tabs. Native AppIcon catalogs must use `'square'` —
 * Apple applies the mask itself, and rounded artwork reads as a stamp inside
 * a stamp.
 */
function tile(body, { size, accent, ground, corners = 'round' }) {
  const bg = ground === 'petrol' ? PETROL : ground === 'none' ? null : CREAM
  const radius = corners === 'round' ? Math.round(size * 0.2227) : 0
  const inset = size * 0.25
  const scale = (size * 0.5) / 100
  const rect = bg
    ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="none">
  ${rect}
  <g transform="translate(${inset} ${inset}) scale(${scale})" color="${accent}">
    ${body}
  </g>
</svg>
`
}

const APPICON_CONTENTS = `{
  "images" : [
    {
      "filename" : "AppIcon.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "dark"
        }
      ],
      "filename" : "AppIcon-dark.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "tinted"
        }
      ],
      "filename" : "AppIcon-tinted.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`

const XCASSETS_CONTENTS = `{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`

async function writePng(svg, dest, { flatten } = {}) {
  let pipeline = sharp(Buffer.from(svg)).resize(1024, 1024)
  if (flatten) pipeline = pipeline.flatten({ background: flatten })
  await pipeline.png().toFile(dest)
}

/**
 * Tinted iOS icons are a grayscale glyph with alpha. SVG rasterizers paint an
 * empty canvas black, so we take luminance of a white-on-black render and use
 * it as the alpha of a white image.
 */
async function writeTintedPng(svg, dest) {
  const { data } = await sharp(Buffer.from(svg))
    .resize(1024, 1024)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const rgba = Buffer.alloc(1024 * 1024 * 4)
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    rgba[j] = 255
    rgba[j + 1] = 255
    rgba[j + 2] = 255
    rgba[j + 3] = data[i]
  }

  await sharp(rgba, { raw: { width: 1024, height: 1024, channels: 4 } })
    .png()
    .toFile(dest)
}

async function build() {
  const written = []

  for (const app of APPS) {
    const body = await readMarkBody(app.mark)
    const appDir = join(ROOT, 'apps', app.dir, 'app')
    await mkdir(appDir, { recursive: true })

    // Favicon. SVG is served to every browser that matters and stays crisp at
    // any density; Next serves app/icon.svg automatically.
    const iconPath = join(appDir, 'icon.svg')
    await writeFile(iconPath, tile(body, { size: 100, ...app }))
    written.push(iconPath)

    // iOS home screen (Safari). Must be a raster — Safari will not take an SVG here.
    const applePath = join(appDir, 'apple-icon.png')
    await sharp(Buffer.from(tile(body, { size: 1024, ...app })))
      .resize(180, 180)
      .png()
      .toFile(applePath)
    written.push(applePath)
  }

  for (const app of NATIVE_IOS) {
    const body = await readMarkBody(app.mark)
    const setDir = join(app.folder, 'Assets.xcassets', 'AppIcon.appiconset')
    await mkdir(setDir, { recursive: true })

    const light = join(setDir, 'AppIcon.png')
    const dark = join(setDir, 'AppIcon-dark.png')
    const tinted = join(setDir, 'AppIcon-tinted.png')

    await writePng(
      tile(body, { size: 1024, accent: app.accent, ground: 'cream', corners: 'square' }),
      light,
      { flatten: CREAM },
    )
    await writePng(
      tile(body, { size: 1024, accent: CAMEL, ground: 'petrol', corners: 'square' }),
      dark,
      { flatten: PETROL },
    )
    await writeTintedPng(
      tile(body, { size: 1024, accent: '#ffffff', ground: 'none', corners: 'square' }),
      tinted,
    )

    await writeFile(join(setDir, 'Contents.json'), APPICON_CONTENTS)
    await writeFile(join(app.folder, 'Assets.xcassets', 'Contents.json'), XCASSETS_CONTENTS)

    written.push(light, dark, tinted)
  }

  for (const path of written) console.log(`  ${path.replace(`${ROOT}/`, '')}`)
  console.log(`\n${written.length} icons written from ${MARKS.replace(`${ROOT}/`, '')}`)
}

build().catch(error => {
  console.error(error)
  process.exit(1)
})

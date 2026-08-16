import type { Metadata } from "next"
import { Suspense } from "react"
import { headers } from "next/headers"
import { Inter, Newsreader } from "next/font/google"
import "./globals.css"
import { LifeOSBar, TimezoneDetector } from "@life-os/ui"
import { isMarketingHost } from "@/lib/site"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
})

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Life OS",
  description: "A foundation for becoming who you're trying to become.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`}>
      <body>
        {/* Host is a per-request dynamic read; Suspense keeps it from forcing
            every route in the app (including static-capable ones like the
            legal pages) out of prerendering under cacheComponents. */}
        <Suspense fallback={children}>
          <SiteChrome>{children}</SiteChrome>
        </Suspense>
      </body>
    </html>
  )
}

async function SiteChrome({ children }: { children: React.ReactNode }) {
  const isMarketingSite = isMarketingHost((await headers()).get("host"))
  if (isMarketingSite) return <>{children}</>

  return (
    <>
      <TimezoneDetector />
      <LifeOSBar current="home" />
      {children}
    </>
  )
}

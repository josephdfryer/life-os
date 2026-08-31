import type { Metadata } from "next"
import { Suspense } from "react"
import { headers } from "next/headers"
import { Inter, Newsreader } from "next/font/google"
import "./globals.css"
import { TimezoneDetector } from "@life-os/ui"
import { AuthenticatedLifeOSBar } from "@life-os/auth/client"
import { isMarketingHost } from "@/lib/site"
import Providers from "./providers"
import HomeMobileTabBar from "../components/HomeMobileTabBar"

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
  title: "LifeOS",
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
        {/* The chrome's host/session work streams independently. Keeping the
            route body outside this boundary prevents a transient duplicate
            page and lets useful content paint without waiting for the bar. */}
        <Suspense fallback={null}>
          <SiteChrome />
        </Suspense>
        {children}
      </body>
    </html>
  )
}

async function SiteChrome() {
  const isMarketingSite = isMarketingHost((await headers()).get("host"))
  if (isMarketingSite) return null

  return (
    <Providers>
      <TimezoneDetector />
      <AuthenticatedLifeOSBar current="home" deferCompactShellNav />
      <HomeMobileTabBar />
    </Providers>
  )
}

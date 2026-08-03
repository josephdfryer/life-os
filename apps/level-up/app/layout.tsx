import type { Metadata, Viewport } from "next"
import { Cormorant_Garamond, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google"
import "./globals.css"
import Providers from "./providers"
import Nav from "@/components/Nav"
import { LifeOSBar } from "@life-os/ui"

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-cormorant",
  display: "swap",
})
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
})
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Level Up — IRL Player",
  description: "A sports-game ratings engine for one real human.",
  appleWebApp: {
    capable: true,
    title: "Level Up",
    // The session screen paints its own chrome to the top edge, so the status
    // bar has to sit over it rather than reserve a band of default white.
    statusBarStyle: "black-translucent",
  },
}

export const viewport: Viewport = {
  themeColor: "#1E1C18",
  // cover, so the layout reaches under the notch and the home indicator and we
  // control the inset ourselves with env(safe-area-inset-*).
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // A gym app gets wet, gloved, mistimed taps. Double-tap zoom on the commit
  // button would be a mis-logged set, and every value is reachable without it.
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${plexMono.variable} ${plexSans.variable}`}>
      <body>
        <Providers>
          <LifeOSBar current="levelUp" />
          <Nav />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  )
}

import type { Metadata, Viewport } from "next"
import { Cormorant_Garamond, IBM_Plex_Mono, IBM_Plex_Sans, Inter, Newsreader } from "next/font/google"
import "./globals.css"
import Providers from "./providers"
import Nav from "@/components/Nav"
import { AuthenticatedLifeOSBar } from "@life-os/auth/client"

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
})
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})
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
  title: "Level Up",
  description: "Character sheet for skills across life — fitness, communication, and more.",
  appleWebApp: {
    capable: true,
    title: "Level Up",
    statusBarStyle: "default",
  },
}

export const viewport: Viewport = {
  themeColor: "#e9e3d8",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${inter.variable} ${cormorant.variable} ${plexMono.variable} ${plexSans.variable}`}
    >
      <body>
        <Providers>
          <AuthenticatedLifeOSBar current="levelUp" />
          <Nav />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  )
}

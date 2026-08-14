import type { Metadata } from "next"
import { Inter, Newsreader } from "next/font/google"
import "./globals.css"
import Providers from "./providers"
import { TimezoneDetector } from "@life-os/ui"
import { AuthenticatedLifeOSBar } from "@life-os/auth/client"

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
  title: "Places",
  description: "Your private map of memory and spend",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`} style={{ height: "100%" }}>
      <body style={{ height: "100%" }}>
        <Providers>
          <TimezoneDetector />
          <AuthenticatedLifeOSBar current="places" />
          {children}
        </Providers>
      </body>
    </html>
  )
}

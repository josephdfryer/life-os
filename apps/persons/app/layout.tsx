import type { Metadata } from "next"
import { Inter, Newsreader } from "next/font/google"
import "./globals.css"
import Header from "@/components/layout/Header"
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
  title: "Persons",
  description: "Your personal CRM",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`} style={{ height: "100%" }}>
      <body style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <Providers>
          <TimezoneDetector />
          <AuthenticatedLifeOSBar current="persons" />
          <Header />
          <main style={{ flex: 1, overflowY: "auto" }}>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}

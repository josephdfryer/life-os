import { Inter, Newsreader } from "next/font/google"
import "./globals.css"
import { TimezoneDetector } from "@life-os/ui"
import { AuthenticatedLifeOSBar } from "@life-os/auth/client"
import Providers from "./providers"

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

export const metadata = { title: "Life OS Assistant" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`}>
      <body>
        <Providers>
          <TimezoneDetector />
          <AuthenticatedLifeOSBar current="assistant" />
          {children}
        </Providers>
      </body>
    </html>
  )
}

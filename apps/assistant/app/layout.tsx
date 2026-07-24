import { Inter, Newsreader } from "next/font/google"
import "./globals.css"
import { LifeOSBar } from "@life-os/ui"

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
        <LifeOSBar current="assistant" />
        {children}
      </body>
    </html>
  )
}

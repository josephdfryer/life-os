import type { Metadata } from "next"
import { Playfair_Display, DM_Mono } from "next/font/google"
import "./globals.css"
import Header from "@/components/layout/Header"
import Providers from "./providers"

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
})

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-dm-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Events",
  description: "What happened, what is happening, what is next",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmMono.variable}`} style={{ height: "100%" }}>
      <body style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <Providers>
          <Header />
          <main style={{ flex: 1, overflowY: "auto" }}>{children}</main>
        </Providers>
      </body>
    </html>
  )
}
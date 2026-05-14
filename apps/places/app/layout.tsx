import type { Metadata } from "next"
import { Playfair_Display, DM_Mono } from "next/font/google"
import "./globals.css"
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
  title: "Places",
  description: "Your private map of memory and spend",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmMono.variable}`} style={{ height: "100%" }}>
      <body style={{ height: "100%" }}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}

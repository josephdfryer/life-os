import type { Metadata } from "next"
import "./globals.css"
import Header from "@/components/layout/Header"
import Providers from "./providers"

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
    <html lang="en" style={{ height: "100%" }}>
      <body style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <Providers>
          <Header />
          <main style={{ flex: 1, overflowY: "auto" }}>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}

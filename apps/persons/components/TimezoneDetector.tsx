"use client"

import { useEffect } from "react"

// Silently sets the tz cookie on first visit using the browser's detected timezone.
export default function TimezoneDetector() {
  useEffect(() => {
    if (!document.cookie.split(";").some(c => c.trim().startsWith("tz="))) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`
    }
  }, [])
  return null
}

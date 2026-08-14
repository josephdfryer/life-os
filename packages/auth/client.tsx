"use client"

import { LifeOSBar, type LifeOSBarProps } from "@life-os/ui"
import { signOut, useSession } from "next-auth/react"

export function AuthenticatedLifeOSBar({ current, ...props }: LifeOSBarProps) {
  const { data: session } = useSession()

  return (
    <LifeOSBar
      {...props}
      current={current}
      account={session?.user}
      onSignOut={() => signOut({ callbackUrl: "/login" })}
    />
  )
}

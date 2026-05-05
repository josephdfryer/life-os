import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { db } from "@/lib/db"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase()
      if (!email) return false
      if (envApprovedEmails().includes(email)) return true
      try {
        const existingUsers = await db.user.count()
        if (existingUsers === 0) return true
        const approved = await db.approvedEmail.findUnique({ where: { email }, select: { status: true } })
        return approved?.status === "approved"
      } catch {
        return false
      }
    },
    authorized({ auth: session }) {
      return !!session?.user
    },
  },
})

function envApprovedEmails() {
  return [
    process.env.ALLOWED_EMAILS,
    process.env.OWNER_EMAILS,
    process.env.ADMIN_EMAILS,
  ].filter(Boolean)
    .flatMap(value => value!.split(","))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
}

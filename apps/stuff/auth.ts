import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

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
      const allowed = process.env.ALLOWED_EMAILS
      if (allowed) {
        const list = allowed.split(",").map(e => e.trim().toLowerCase())
        if (!list.includes(user.email?.toLowerCase() ?? "")) return false
      }
      return true
    },
    authorized({ auth: session }) {
      return !!session?.user
    },
  },
})

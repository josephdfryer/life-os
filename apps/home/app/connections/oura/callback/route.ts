import { redirect } from "next/navigation"
import { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const query = request.nextUrl.search
  redirect(`/admin/connections/oura/callback${query}`)
}

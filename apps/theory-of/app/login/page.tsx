import { redirect } from "next/navigation"
import { personsUrl } from "@/lib/persons-url"

export default function LoginRedirect() {
  redirect(personsUrl("/login"))
}

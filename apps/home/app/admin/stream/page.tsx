import StreamClient from "../../../components/StreamClient"
import { AdminChrome } from "../AdminChrome"

export const metadata = { title: "Stream · Admin · LifeOS" }

export default function AdminStreamPage() {
  return (
    <AdminChrome tab="stream" intro="Everything that has happened, in one chronological view.">
      <div style={{ marginTop: 28 }}>
        <StreamClient />
      </div>
    </AdminChrome>
  )
}

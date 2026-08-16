import { NextResponse } from "next/server"
import { start } from "workflow/api"
import { nightlyTheoryRefreshWorkflow } from "@/workflows/nightly-theory-refresh"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const run = await start(nightlyTheoryRefreshWorkflow)
  return NextResponse.json({ workflowRunId: run.runId }, { status: 202 })
}

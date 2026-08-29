import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getWorkspaceId } from "@/lib/workspace";
import { BACKGROUND_EVENT_TYPES } from "@life-os/domain";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = await getWorkspaceId(session.user.email);

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");
  const take = Math.min(Number(searchParams.get("take") ?? 50), 100);

  const events = await db.event.findMany({
    where: {
      workspaceId,
      type: { notIn: [...BACKGROUND_EVENT_TYPES] },
      ...(search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : {}),
    },
    include: {
      place: { select: { name: true } },
      interactions: {
        where: { personId: { not: null } },
        include: { person: { select: { first: true, last: true } } },
        take: 5,
      },
    },
    orderBy: { start: "desc" },
    take,
  });

  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = await getWorkspaceId(session.user.email);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!name)
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!type)
    return NextResponse.json({ error: "Type is required" }, { status: 400 });

  const startRaw = body.start ?? body.timestamp;
  const start = startRaw ? new Date(String(startRaw)) : new Date();
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid start time" }, { status: 400 });
  }

  let end: Date | null = null;
  if (body.end) {
    end = new Date(String(body.end));
    if (Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid end time" }, { status: 400 });
    }
  }

  const event = await db.event.create({
    data: {
      workspaceId,
      name,
      type,
      start,
      end,
      timestamp: start,
      ...(typeof body.placeId === "string" && body.placeId
        ? { placeId: body.placeId }
        : {}),
      ...(typeof body.notes === "string" && body.notes
        ? { notes: body.notes }
        : {}),
      ...(typeof body.transcript === "string" && body.transcript
        ? { transcript: body.transcript }
        : {}),
    },
  });

  return NextResponse.json(event, { status: 201 });
}

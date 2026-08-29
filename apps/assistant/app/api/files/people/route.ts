import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accessErrorResponse, requireWorkspaceAccess } from "@/lib/access";

export async function GET(request: Request) {
  try {
    const access = await requireWorkspaceAccess();
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return NextResponse.json({ people: [] });
    const people = await db.person.findMany({
      where: {
        workspaceId: access.workspaceId,
        OR: [
          { first: { contains: q, mode: "insensitive" as const } },
          { last: { contains: q, mode: "insensitive" as const } },
          {
            emailSearch: {
              contains: q.toLowerCase(),
              mode: "insensitive" as const,
            },
          },
        ],
      },
      orderBy: [{ first: "asc" }, { last: "asc" }, { id: "asc" }],
      take: 20,
      select: { id: true, first: true, last: true, headline: true },
    });
    return NextResponse.json({ people });
  } catch (error) {
    const { error: message, status } = accessErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}

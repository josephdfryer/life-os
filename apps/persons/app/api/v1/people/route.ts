import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth";
import { createPerson } from "@/server/domain/persons";
import { formatPerson } from "@/server/domain/dto";
import { created, handleRouteError } from "@/server/api/respond";

export async function GET(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "people.read");
  if (!auth) return unauthorized();

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");
  const limit = Math.min(
    500,
    Math.max(1, Number(searchParams.get("limit") ?? 50)),
  );
  const cursor = searchParams.get("cursor") ?? null;
  const offset = cursor
    ? null
    : Math.max(0, Number(searchParams.get("offset") ?? 0));

  const where = search
    ? {
        workspaceId: auth.workspaceId,
        OR: [
          { first: { contains: search, mode: "insensitive" as const } },
          { last: { contains: search, mode: "insensitive" as const } },
          {
            emailSearch: {
              contains: search.toLowerCase(),
              mode: "insensitive" as const,
            },
          },
          { company: { contains: search, mode: "insensitive" as const } },
          { headline: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : { workspaceId: auth.workspaceId };

  const [persons, total] = await Promise.all([
    db.person.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : { skip: offset ?? 0 }),
    }),
    db.person.count({ where }),
  ]);

  const nextCursor =
    persons.length === limit ? persons[persons.length - 1].id : null;

  return NextResponse.json({
    data: persons.map(formatPerson),
    total,
    limit,
    ...(cursor != null ? { nextCursor } : { offset: offset ?? 0 }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "people.write");
  if (!auth) return unauthorized();
  try {
    return created(await createPerson(await req.json(), auth.actor));
  } catch (error) {
    return handleRouteError(error);
  }
}

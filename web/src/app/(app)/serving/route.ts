import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { TEAM_COOKIE } from "@/lib/teams";

/**
 * Root and observers: leave the team they opened and go back to Brighton Serving, their own view
 * outside every team.
 */
export async function GET(request: NextRequest) {
  // A prefetch must not switch view: only a real visit does.
  if (request.headers.get("next-router-prefetch")) return new NextResponse(null, { status: 204 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/", request.url));
  const res = NextResponse.redirect(new URL("/home", request.url));
  if (user.isRoot || (user.observerGroup && !user.isDeveloper)) res.cookies.delete(TEAM_COOKIE);
  return res;
}

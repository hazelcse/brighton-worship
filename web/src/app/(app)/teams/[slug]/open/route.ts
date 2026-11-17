import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasDeveloperAccess, VIEW_AS_COOKIE, VIEW_AS_PERSON } from "@/lib/auth";
import { TEAM_COOKIE, teamBySlug } from "@/lib/teams";

/**
 * Root, developers and observers (their own group's teams only): switch to a team and go straight to one of its pages, e.g.
 * /teams/youth-worship/open?next=/team/<id> opens that member in Youth Worship. Root then has the
 * team lead's powers there: add, edit and remove members, their permissions, rosters and so on.
 * Only paths inside the app are followed (anything else goes to the team's members).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // A prefetch must not switch team: only a real visit does.
  if (request.headers.get("next-router-prefetch")) return new NextResponse(null, { status: 204 });
  const user = await getCurrentUser();
  const home = new URL("/", request.url);
  if (!user || !(user.isRoot || user.isObserver || hasDeveloperAccess(user))) return NextResponse.redirect(home);
  const team = await teamBySlug((await params).slug);
  if (!team) return NextResponse.redirect(new URL(user.isObserver ? "/home" : "/teams", request.url));
  // An observer only looks at the teams of its own group.
  if (user.isObserver && team.group !== user.observerGroup) return NextResponse.redirect(new URL("/home", request.url));

  const wanted = request.nextUrl.searchParams.get("next") ?? "";
  const next = /^\/[a-z]/.test(wanted) && !wanted.startsWith("//") ? wanted : "/team";
  const res = NextResponse.redirect(new URL(next, request.url));
  res.cookies.set(TEAM_COOKIE, team.slug, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // Acting as a person is tied to the last team; a developer's observer view carries over.
  if (request.cookies.get(VIEW_AS_COOKIE)?.value?.startsWith(VIEW_AS_PERSON)) res.cookies.delete(VIEW_AS_COOKIE);
  return res;
}

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { formatTime } from "@/lib/roster";
import { morningServiceTonight } from "@/lib/night-owl";
import { TEAM_HOME, getSessionUser } from "@/lib/auth";
import { LoginButton } from "@/components/login-dialog";
import { TeamLogin } from "@/components/team-login";
import { chosenLoginKind, KIND_TITLE, loadTeams, type TeamKind } from "@/lib/teams";

/** Sends already-signed-in users straight to the app. Streams in after the static shell. */
async function RedirectIfSignedIn() {
  const user = await getSessionUser();
  if (!user) return null;
  // Their team's own home (a media team's is /media); root and observers always get /home.
  const home = user.team && !user.isRoot && !user.isObserver ? TEAM_HOME[user.team.kind] : "/home";
  redirect(user.mustChangePassword ? "/change-password" : home);
  return null;
}

/** 12am-5am (Singapore time) before a morning Sunday service: tell them to go to bed. */
async function GoToSleep() {
  await connection(); // depends on the time right now, so never prerendered
  const service = await morningServiceTonight();
  if (!service) return null;
  return (
    <p role="status" className="relative mt-8 max-w-md text-center text-base text-ink-foreground/85">
      <span className="block font-display text-2xl font-semibold text-ink-foreground">What are you doing awake at this hour?</span>
      {service.name} is at {formatTime(service.time)}. Go to sleep!
    </p>
  );
}

export default function LandingPage() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-ink px-4 text-ink-foreground">
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(180,83,9,0.22),transparent_65%)]"
      />
      <Suspense fallback={<TitleFallback />}>
        <TeamTitleAndLogin>
          <Suspense fallback={null}>
            <GoToSleep />
          </Suspense>
        </TeamTitleAndLogin>
      </Suspense>
    </main>
  );
}

/**
 * One title per kind of team that exists ("Brighton Worship", "Brighton Media"), opening on the one
 * chosen last time. Hold it to switch.
 */
async function TeamTitleAndLogin({ children }: { children: React.ReactNode }) {
  const [teams, initial] = await Promise.all([loadTeams(), chosenLoginKind()]);
  const kinds = (Object.keys(KIND_TITLE) as TeamKind[]).filter((k) => teams.some((t) => t.kind === k));
  return (
    <TeamLogin teams={kinds.map((k) => ({ slug: k, name: KIND_TITLE[k] }))} initial={initial}>
      {children}
    </TeamLogin>
  );
}

/** Shown for the moment before the team list arrives. */
function TitleFallback() {
  return (
    <>
      <h1 className="relative text-center font-display text-6xl font-semibold leading-none tracking-tight sm:text-8xl lg:text-9xl">
        Brighton
        <br />
        &nbsp;
      </h1>
      <div className="relative mt-12">
        <LoginButton team="worship" teamName="Brighton Worship" />
      </div>
    </>
  );
}

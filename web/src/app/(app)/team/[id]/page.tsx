import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TeamLoader } from "@/components/team-loader";
import { requireTeamUser } from "@/lib/auth";
import { GENDER_LABEL, INSTRUMENT_LABEL, SERVES_LABEL, isPlaceholderEmail, loadMember, ministryLabel } from "@/lib/team";
import { updateMember } from "../actions";
import { MemberForm } from "@/components/team/member-form";
import { DeleteMemberButton } from "@/components/team/delete-member-button";
import { ResetPasswordButton } from "@/components/team/reset-password-button";
import { MemberRules } from "@/components/team/member-rules";
import { rolesNoun, teamPerson } from "@/lib/team-config";
import { PersonalRule } from "@/components/team/personal-rule";

async function MemberView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireTeamUser(`/team/${id}`, "team");
  if (!user.can("team.view")) notFound();
  const loaded = await loadMember(id, user.team.id, { includeDevelopers: user.isRoot, observerOf: user.team.group }); // developer and observer accounts: root only
  if (!loaded) notFound();
  // Only root (and developers) see a member's gender; it isn't sent to anyone else.
  // EM/CM and "serves at" read as unset in a team that doesn't use them (e.g. Youth).
  const m = teamPerson(user.isLead ? loaded : { ...loaded, gender: null }, user.team.config);
  const ministry = ministryLabel(m.emPercent);

  return (
    <div className="space-y-6">
      <Link href="/team" className="text-sm text-muted hover:text-foreground">
        ← Team
      </Link>
      <header className="space-y-2">
        <p className="text-sm text-muted">
          {user.isRoot && !m.isDeveloper && !m.isObserver && `${user.team.name} · `}
          {m.isDeveloper
            ? "Developer account · not on the team or the roster"
            : m.isObserver
              ? `Observer account · read-only, on no team or roster`
              : m.uid != null
                ? `Member #${m.uid}`
                : "Member"}
          {/* Linked profiles: the same person on another team, with their own profile there. */}
          {user.isLead && m.otherTeams.length > 0 && ` · also on ${m.otherTeams.join(" and ")}`}
        </p>
        <h1 className="font-display text-4xl font-semibold">{m.name}</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          {ministry && <span className="rounded-full border border-border bg-surface px-3 py-1 font-medium">{ministry}</span>}
          {m.gender && <span className="rounded-full border border-border bg-surface px-3 py-1">{GENDER_LABEL[m.gender]}</span>}
          {m.serves !== "both" && <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-900">{SERVES_LABEL[m.serves]}</span>}
          {m.instruments.map((i) => (
            <span key={i} className="rounded-full bg-background px-3 py-1">
              {INSTRUMENT_LABEL[i] ?? i}
            </span>
          ))}
        </div>
      </header>

      {/* Root looking at the observer account: only its email and password (it's on no team, so has no profile here). */}
      {m.isObserver ? (
        <section className="space-y-2 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Password</h2>
          <p className="text-sm text-muted">{m.email}</p>
          <ResetPasswordButton id={m.id} name={m.name} />
        </section>
      ) : (
      <>
      {/* Leads, root and developers: what this person shouldn't be rostered for (teams that use personal rules). */}
      {user.isLead && !m.isDeveloper && user.team.config.memberFields.rules && <PersonalRule id={m.id} name={m.name} instruments={m.instruments} noRosterRoles={m.noRosterRoles} labels={INSTRUMENT_LABEL} noun={rolesNoun(user.team.config).toLowerCase()} />}

      {user.can("roster.edit") && <MemberRules member={m} team={user.team} />}

      {user.isLead ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Edit member</h2>
            {m.otherTeams.length > 0 && (
              <p className="text-sm text-muted">
                Name, email and gender are shared with their {m.otherTeams.join(" and ")} profile. Everything else here is
                for {user.team.name} only.
              </p>
            )}
            {isPlaceholderEmail(m.email) && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This member has a placeholder email. Replace it with their real one so they can receive emails.
              </p>
            )}
            <MemberForm
              mode="edit"
              teamConfig={user.team.config}
              action={updateMember.bind(null, m.id)}
              defaults={{ name: m.name, email: m.email, instruments: m.instruments, emPercent: m.emPercent, gender: m.gender, serves: m.serves }}
            />
          </section>

          <div className="space-y-6">
            <section className="space-y-2 rounded-xl border border-border bg-surface p-4 sm:p-5">
              <h2 className="text-lg font-semibold">Permissions</h2>
              <p className="text-sm capitalize text-muted">
                {m.isLead ? "Lead: everything" : m.isDeveloper ? "Developer: everything" : m.groups.length ? `Group: ${m.groups.join(", ")}` : "No permission group"}
              </p>
              {!m.isLead && !m.isDeveloper && (
                <Link href={`/team/permissions/users/${m.id}`} className="text-sm text-accent underline-offset-2 hover:underline">
                  View or change permissions
                </Link>
              )}
            </section>
            <section className="space-y-2 rounded-xl border border-border bg-surface p-4 sm:p-5">
              <h2 className="text-lg font-semibold">Password</h2>
              <p className="text-sm text-muted">
                Passwords are stored as a secure hash, so nobody (root included) can see them. New members start on the
                team&apos;s default password and choose their own the first time they log in.
              </p>
              {!m.isLead && (!m.isDeveloper || user.isDeveloper) && <ResetPasswordButton id={m.id} name={m.name} />}
            </section>
            {!m.isLead && (!m.isDeveloper || user.isDeveloper) && (
              <section className="space-y-2 rounded-xl border border-red-200 bg-surface p-4 sm:p-5">
                <h2 className="text-lg font-semibold">{m.otherTeams.length ? `Remove from ${user.team.name}` : "Delete member"}</h2>
                <p className="text-sm text-muted">
                  {m.otherTeams.length
                    ? `Takes them off ${user.team.name} only. Their login and their ${m.otherTeams.join(" and ")} profile stay.`
                    : "Removes their login and card. This can't be undone."}
                </p>
                <DeleteMemberButton id={m.id} name={m.name} team={user.team.name} otherTeams={m.otherTeams} />
              </section>
            )}
          </div>
        </div>
      ) : (
        <dl className="grid gap-4 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-2 sm:p-5">
          <div>
            <dt className="text-muted">{rolesNoun(user.team.config)}</dt>
            <dd className="mt-0.5 font-medium">{m.instruments.map((i) => INSTRUMENT_LABEL[i] ?? i).join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Ministry</dt>
            <dd className="mt-0.5 font-medium">{ministry ?? "—"}</dd>
          </div>
        </dl>
      )}
      </>
      )}
    </div>
  );
}

export default function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<TeamLoader label="Loading the profile" className="py-24" />}>
      <MemberView params={params} />
    </Suspense>
  );
}

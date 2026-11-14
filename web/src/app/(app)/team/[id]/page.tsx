import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TeamLoader } from "@/components/team-loader";
import { requireUser } from "@/lib/auth";
import { GENDER_LABEL, INSTRUMENT_LABEL, SERVES_LABEL, isPlaceholderEmail, loadMember, ministryLabel } from "@/lib/team";
import { updateMember } from "../actions";
import { MemberForm } from "@/components/team/member-form";
import { DeleteMemberButton } from "@/components/team/delete-member-button";
import { ResetPasswordButton } from "@/components/team/reset-password-button";
import { MemberRules } from "@/components/team/member-rules";
import { PersonalRule } from "@/components/team/personal-rule";

async function MemberView({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user.can("team.view")) notFound();
  const { id } = await params;
  const loaded = await loadMember(id, { includeDevelopers: user.isRoot });
  if (!loaded) notFound();
  // Only root (and developers) see a member's gender; it isn't sent to anyone else.
  const m = user.isRoot ? loaded : { ...loaded, gender: null };
  const ministry = ministryLabel(m.emPercent);

  return (
    <div className="space-y-6">
      <Link href="/team" className="text-sm text-muted hover:text-foreground">
        ← Team
      </Link>
      <header className="space-y-2">
        <p className="text-sm text-muted">
          {m.isDeveloper ? "Developer account · not on the team or the roster" : m.uid != null ? `Member #${m.uid}` : "Member"}
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

      {/* Root and developers: what this person shouldn't be rostered for. */}
      {user.isRoot && !m.isDeveloper && <PersonalRule id={m.id} name={m.name} instruments={m.instruments} noRosterRoles={m.noRosterRoles} labels={INSTRUMENT_LABEL} />}

      {user.can("roster.edit") && <MemberRules member={m} />}

      {user.isRoot ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Edit member</h2>
            {isPlaceholderEmail(m.email) && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This member has a placeholder email. Replace it with their real one so they can receive emails.
              </p>
            )}
            <MemberForm
              mode="edit"
              action={updateMember.bind(null, m.id)}
              defaults={{ name: m.name, email: m.email, instruments: m.instruments, emPercent: m.emPercent, gender: m.gender, serves: m.serves }}
            />
          </section>

          <div className="space-y-6">
            <section className="space-y-2 rounded-xl border border-border bg-surface p-4 sm:p-5">
              <h2 className="text-lg font-semibold">Permissions</h2>
              <p className="text-sm capitalize text-muted">
                {m.isRoot ? "Root: everything" : m.isDeveloper ? "Developer: everything" : m.groups.length ? `Group: ${m.groups.join(", ")}` : "No permission group"}
              </p>
              {!m.isRoot && !m.isDeveloper && (
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
              {!m.isRoot && (!m.isDeveloper || user.isDeveloper) && <ResetPasswordButton id={m.id} name={m.name} />}
            </section>
            {!m.isRoot && (!m.isDeveloper || user.isDeveloper) && (
              <section className="space-y-2 rounded-xl border border-red-200 bg-surface p-4 sm:p-5">
                <h2 className="text-lg font-semibold">Delete member</h2>
                <p className="text-sm text-muted">Removes their login and card. This can&apos;t be undone.</p>
                <DeleteMemberButton id={m.id} name={m.name} />
              </section>
            )}
          </div>
        </div>
      ) : (
        <dl className="grid gap-4 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-2 sm:p-5">
          <div>
            <dt className="text-muted">Instruments</dt>
            <dd className="mt-0.5 font-medium">{m.instruments.map((i) => INSTRUMENT_LABEL[i] ?? i).join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Ministry</dt>
            <dd className="mt-0.5 font-medium">{ministry ?? "—"}</dd>
          </div>
        </dl>
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

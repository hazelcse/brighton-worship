import Link from "next/link";
import { frequencyExemptions, quarterOf, ruleSentence, rulesAbout, type MemberRuleReason } from "@/lib/roster";
import { loadAllRules, loadPeople } from "@/lib/roster-data";
import { SERVES_LABEL, type Serves } from "@/lib/team";

const REASON: Record<MemberRuleReason, { label: string; style: string }> = {
  personal: { label: "Personal", style: "bg-accent/10 text-accent" },
  "serve-less": { label: "Serves less", style: "bg-accent/10 text-accent" },
  exception: { label: "Exception", style: "bg-sky-100 text-sky-800" },
  group: { label: "Group", style: "bg-violet-100 text-violet-800" },
  instrument: { label: "Instrument", style: "bg-amber-100 text-amber-800" },
};

/** Admin view: the roster rules that apply to this member specifically (not "everyone" rules). */
export async function MemberRules({
  member,
}: {
  member: { id: string; name: string; instruments: string[]; emPercent: number | null; serves: Serves };
}) {
  const [all, people] = await Promise.all([loadAllRules(), loadPeople()]);
  // Defaults, plus rules of rosters still in use (not archived ones).
  const rules = all.filter((r) => r.rosterId === null || (r.roster && r.roster.status !== "archived"));
  const mine = rulesAbout(member, rules);
  const factor = mine.find((m) => m.reason === "serve-less")?.rule.params;
  const share = factor && factor.template === "fairness" ? factor.reduced?.[member.id] : undefined;

  return (
    <section aria-labelledby="member-rules-title" className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="member-rules-title" className="text-lg font-semibold">
          Roster rules for {member.name}
        </h2>
        <p className="text-sm text-muted">
          Serves at: <span className="font-medium text-foreground">{SERVES_LABEL[member.serves]}</span>
          {" · "}Share of the load: <span className="font-medium text-foreground">{share ?? 1}</span>
          {share !== undefined && " (serves less)"}
        </p>
      </div>
      {mine.length === 0 ? (
        <p className="text-sm text-muted">No rules single out {member.name}. Only the rules for everyone apply.</p>
      ) : (
        <ul className="divide-y divide-border">
          {mine.map(({ rule, reason }) => {
            const r = all.find((x) => x.id === rule.id)!;
            return (
              <li key={rule.id} className={`flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 ${rule.enabled ? "" : "opacity-60"}`}>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${REASON[reason].style}`}>{REASON[reason].label}</span>
                <p className="min-w-0 flex-1 text-sm">
                  {reason === "serve-less"
                    ? `${member.name} serves less under “Share the load fairly” (share ${share}).`
                    : ruleSentence(rule.params, people, frequencyExemptions(rule, rules, people))}
                </p>
                <span className="flex shrink-0 flex-wrap gap-1.5 text-xs text-muted">
                  {reason !== "serve-less" && <span>{rule.hard ? "Hard" : `Soft · ${rule.weight}`}</span>}
                  {!rule.enabled && <span>· Off</span>}
                  <span>·</span>
                  {r.roster ? (
                    <Link href={`/roster/${r.roster.id}/plan`} className="text-accent underline-offset-2 hover:underline">
                      {quarterOf(r.roster.starts_on).label} only
                    </Link>
                  ) : (
                    <span>Default</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted">Rules are added and changed on a roster&apos;s planning page.</p>
    </section>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/action-form";
import { KIND_TITLE, memberKinds, type TeamKind } from "@/lib/teams";
import { setLandingKind } from "./actions";

export const metadata: Metadata = { title: "Settings · Brighton Serving" };

async function SettingsView() {
  const user = await requireUser("any");
  const [kinds, { data: profile }] = await Promise.all([
    memberKinds(user.id),
    createAdminClient().from("profiles").select("landing_kind").eq("id", user.id).maybeSingle(),
  ]);
  const both = kinds.has("worship") && kinds.has("media");
  const landing: TeamKind = profile?.landing_kind === "media" ? "media" : "worship";

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div>
        <h2 className="text-lg font-semibold">When I log in</h2>
        <p className="mt-1 text-sm text-muted">
          {both
            ? "You're on a worship team and a media team. Choose which one opens when you log in; you can still switch from the profile menu."
            : "You're on one kind of team, so you always land on it when you log in."}
        </p>
      </div>
      {both && (
        <ActionForm action={setLandingKind} submitLabel="Save" className="space-y-2">
          {(["worship", "media"] as const).map((k) => (
            <label key={k} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5">
              <input type="radio" name="landing" value={k} defaultChecked={landing === k} className="accent-accent" />
              {KIND_TITLE[k]}
            </label>
          ))}
        </ActionForm>
      )}
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-4xl font-semibold">Settings</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl border border-border bg-surface" />}>
        <SettingsView />
      </Suspense>
    </div>
  );
}

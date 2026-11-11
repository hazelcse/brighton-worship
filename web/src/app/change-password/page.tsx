import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { signOut } from "@/app/actions/auth";
import { ChangePasswordForm } from "@/components/change-password-form";

export const metadata: Metadata = { title: "Choose a password · Brighton Worship" };

/** Only for members still on the default password; everyone else carries on to the app. */
async function Gate() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (!user.mustChangePassword) redirect("/home");
  return (
    <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-foreground shadow-2xl">
      <h1 className="font-display text-3xl font-semibold">Choose a password</h1>
      <p className="mt-2 text-sm text-muted">
        Welcome{user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}! You signed in with the team&apos;s default password.
        Pick one of your own to carry on.
      </p>
      <ChangePasswordForm />
      <form action={signOut} className="mt-4 text-center">
        <button type="submit" className="text-sm text-muted hover:underline">
          Log out
        </button>
      </form>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-ink px-4 py-10">
      <Suspense fallback={null}>
        <Gate />
      </Suspense>
    </main>
  );
}

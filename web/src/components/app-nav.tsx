"use client";

import { PopulateDialog } from "@/components/populate-dialog";
import { ResetAppDataDialog } from "@/components/reset-app-data";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions/auth";
import { ViewAsMenu } from "@/components/view-as";
import { Inbox } from "@/components/inbox";
import type { UpdateItem } from "@/lib/serving";

type NavLink = { href: string; label: string };
type NavItem = NavLink & { children?: readonly NavLink[] };

const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/roster",
    label: "Roster",
    children: [
      { href: "/roster", label: "Roster" },
      { href: "/roster/schedule", label: "Schedule" },
    ],
  },
  { href: "/team", label: "Team" },
  { href: "/sessions", label: "Sessions" },
  { href: "/songs", label: "Songs" },
];

type NavUser = {
  name: string;
  email: string;
  isRoot: boolean;
  canAdmin: boolean;
  isDeveloper?: boolean;
  viewAs?: string | null;
  viewAsKey?: string | null;
  groups?: string[];
  people?: { id: string; name: string }[];
  profileId?: string | null;
  /** Counts shown next to top-level links, e.g. new song library updates on Songs. */
  badges?: Record<string, number>;
  /** Roster updates for the inbox; undefined: no inbox (they can't see the roster). */
  inbox?: UpdateItem[];
};

/** Root also gets Tracking (past sessions) under Sessions. */
function navItemsFor(isRoot: boolean): readonly NavItem[] {
  if (!isRoot) return NAV_ITEMS;
  return NAV_ITEMS.map((item) =>
    item.href === "/sessions"
      ? {
          ...item,
          children: [
            { href: "/sessions", label: "Sessions" },
            { href: "/sessions/tracking", label: "Tracking" },
          ],
        }
      : item,
  );
}

/** A small count next to a nav link (nothing when 0). */
function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white" aria-label={`${n} new`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The child link matching the page: the most specific href wins (Schedule over Roster). */
function activeChild(pathname: string, item: NavItem): string | undefined {
  return item.children
    ?.filter((c) => isActive(pathname, c.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** The developer tools in the Develop menu. */
function DevelopItems({ onPopulate, onReset }: { onPopulate: () => void; onReset: () => void }) {
  return (
    <>
      <button type="button" role="menuitem" onClick={onReset} className="block w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-background">
        Reset app data
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onPopulate}
        className="block w-full border-t border-border px-4 py-2.5 text-left text-sm hover:bg-background"
      >
        Populate…
      </button>
    </>
  );
}

/** Shown while the signed-in user is loading. */
export function AppNavSkeleton() {
  return (
    <header className="sticky top-0 z-30 bg-ink text-ink-foreground">
      <div className="mx-auto flex h-14 max-w-page items-center px-4 sm:px-6">
        <span className="font-display text-xl font-medium tracking-tight">Brighton Worship</span>
        <span className="ml-auto h-9 w-9 rounded-full bg-white/10" />
      </div>
    </header>
  );
}

/** Fired by a page once the viewer has seen what a nav badge counts (detail: the badge's href). */
export const BADGE_SEEN_EVENT = "nav-badge-seen";

export function AppNav({ user: given }: { user: NavUser }) {
  const pathname = usePathname();
  // Badges a page has since marked as seen (the layout keeps its old counts until a reload).
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => {
    const onSeen = (e: Event) => setSeen((s) => [...s, String((e as CustomEvent).detail)]);
    window.addEventListener(BADGE_SEEN_EVENT, onSeen);
    return () => window.removeEventListener(BADGE_SEEN_EVENT, onSeen);
  }, []);
  const user = { ...given, badges: Object.fromEntries(Object.entries(given.badges ?? {}).filter(([href]) => !seen.includes(href))) };
  const navItems = navItemsFor(user.isRoot);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [populateOpen, setPopulateOpen] = useState(false);
  const devRef = useRef<HTMLLIElement>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menus after navigating.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setSidebarOpen(false);
    setMenuOpen(false);
    setDevOpen(false);
  }

  // Escape closes everything; clicking outside closes the account menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSidebarOpen(false);
        setMenuOpen(false);
        setDevOpen(false);
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (devRef.current && !devRef.current.contains(e.target as Node)) setDevOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  // Stop the page scrolling behind the open sidebar.
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  const initials = user.name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");

  return (
    <>
      <header className="sticky top-0 z-30 bg-ink text-ink-foreground">
        <nav className="mx-auto flex h-14 max-w-page items-center gap-2 px-4 sm:px-6" aria-label="Main">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
            aria-controls="mobile-sidebar"
            onClick={() => setSidebarOpen(true)}
            className="-ml-2 rounded-md p-2 hover:bg-white/10 md:hidden"
          >
            <MenuIcon />
          </button>

          <Link href="/home" className="mr-4 font-display text-xl font-medium tracking-tight">
            Brighton Worship
          </Link>

          <ul className="hidden items-center gap-1 md:flex">
            {navItems.map((item) =>
              item.children ? (
                // Opens on hover or keyboard focus; the pt-2 bridge keeps it open while moving down.
                <li key={item.href} className="group relative">
                  <Link
                    href={item.href}
                    aria-haspopup="true"
                    aria-current={isActive(pathname, item.href) ? "page" : undefined}
                    className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-ink-foreground/70 transition group-hover:bg-white/10 group-hover:text-ink-foreground aria-[current=page]:bg-white/10 aria-[current=page]:text-ink-foreground"
                  >
                    {item.label}
                    <Badge n={user.badges?.[item.href]} />
                    <ChevronIcon className="opacity-60 transition group-hover:rotate-180" />
                  </Link>
                  <div className="invisible absolute left-0 top-full z-40 pt-2 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    <ul className="w-44 overflow-hidden rounded-xl border border-border bg-surface py-1 text-foreground shadow-lg">
                      {item.children.map((c) => (
                        <li key={c.href}>
                          <Link
                            href={c.href}
                            aria-current={activeChild(pathname, item) === c.href ? "page" : undefined}
                            className="block px-4 py-2.5 text-sm hover:bg-background aria-[current=page]:font-medium aria-[current=page]:text-accent"
                          >
                            {c.label}
                            {c.href === item.href && <Badge n={user.badges?.[item.href]} />}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ) : (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive(pathname, item.href) ? "page" : undefined}
                    className="rounded-md px-3 py-2 text-sm text-ink-foreground/70 transition hover:bg-white/10 hover:text-ink-foreground aria-[current=page]:bg-white/10 aria-[current=page]:text-ink-foreground"
                  >
                    {item.label}
                    <Badge n={user.badges?.[item.href]} />
                  </Link>
                </li>
              ),
            )}
            {user.isDeveloper && (
              <li ref={devRef} className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={devOpen}
                  onClick={() => setDevOpen((o) => !o)}
                  className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-ink-foreground/70 transition hover:bg-white/10 hover:text-ink-foreground aria-expanded:bg-white/10 aria-expanded:text-ink-foreground"
                >
                  Develop
                  <ChevronIcon className={`opacity-60 transition ${devOpen ? "rotate-180" : ""}`} />
                </button>
                {devOpen && (
                  <div role="menu" className="absolute left-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 text-foreground shadow-lg">
                    <DevelopItems
                      onPopulate={() => {
                        setDevOpen(false);
                        setPopulateOpen(true);
                      }}
                      onReset={() => {
                        setDevOpen(false);
                        setResetOpen(true);
                      }}
                    />
                  </div>
                )}
              </li>
            )}
          </ul>

          <div className="ml-auto flex items-center gap-2">
            {user.inbox && <Inbox updates={user.inbox} />}
            <div ref={menuRef} className="relative flex items-center gap-2">
              <button
                type="button"
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
              >
                {initials || "?"}
              </button>
              {user.isDeveloper && (
                <span
                  title={
                    user.viewAs
                      ? `${user.viewAsKey?.startsWith("person:") ? "Acting as" : "Viewing as"} ${user.viewAs}`
                      : "Developer: full access"
                  }
                  className={`max-w-40 truncate rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${user.viewAs ? "border-violet-400 bg-violet-500/15 text-violet-200" : "border-accent/70 bg-accent/10 text-orange-200"}`}
                >
                  {user.viewAs ?? "Dev"}
                </span>
              )}
              {menuOpen && (
                <div className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-lg">
                  <div className="border-b border-border px-4 py-3">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="truncate text-xs text-muted">
                      {user.email || "developer"}
                      {user.email && (user.isDeveloper ? " · developer" : user.isRoot && " · root")}
                    </p>
                  </div>
                  {user.isDeveloper && (
                    <ViewAsMenu viewAs={user.viewAsKey ?? null} groups={user.groups ?? []} people={user.people ?? []} onPicked={() => setMenuOpen(false)} />
                  )}
                  {user.profileId && (
                    <Link href={`/team/${user.profileId}`} className="block px-4 py-2.5 text-sm hover:bg-background">
                      My profile
                    </Link>
                  )}
                  {user.canAdmin && (
                    <Link href="/team/permissions" className="block px-4 py-2.5 text-sm hover:bg-background">
                      Manage permissions
                    </Link>
                  )}
                  <form action={signOut}>
                    <button type="submit" className="w-full px-4 py-2.5 text-left text-sm hover:bg-background">
                      Log out
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      {user.isDeveloper && <ResetAppDataDialog open={resetOpen} onClose={() => setResetOpen(false)} />}
      {user.isDeveloper && <PopulateDialog open={populateOpen} onClose={() => setPopulateOpen(false)} />}

      {/* Mobile sidebar */}
      <div
        aria-hidden
        onClick={() => setSidebarOpen(false)}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity md:hidden ${
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        id="mobile-sidebar"
        aria-label="Main menu"
        inert={!sidebarOpen}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-ink text-ink-foreground transition-transform duration-200 md:hidden ${
          sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/home" onClick={() => setSidebarOpen(false)} className="font-display text-xl font-medium">
            Brighton Worship
          </Link>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
            className="-mr-2 rounded-md p-2 hover:bg-white/10"
          >
            <CloseIcon />
          </button>
        </div>
        <ul className="flex flex-col gap-1 px-2 py-2">
          {navItems.map((item) =>
            item.children ? (
              <li key={item.href}>
                <button
                  type="button"
                  aria-expanded={openGroup === item.href}
                  aria-controls={`mobile-group-${item.label}`}
                  onClick={() => setOpenGroup((g) => (g === item.href ? null : item.href))}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-3 text-left text-base hover:bg-white/10 ${
                    isActive(pathname, item.href) ? "text-ink-foreground" : "text-ink-foreground/75"
                  }`}
                >
                  <span>
                    {item.label}
                    <Badge n={user.badges?.[item.href]} />
                  </span>
                  <ChevronIcon className={`transition ${openGroup === item.href ? "rotate-180" : ""}`} />
                </button>
                {openGroup === item.href && (
                  <ul id={`mobile-group-${item.label}`} className="ml-4 mt-1 flex flex-col gap-1 border-l border-white/15 pl-2">
                    {item.children.map((c) => (
                      <li key={c.href}>
                        <Link
                          href={c.href}
                          aria-current={activeChild(pathname, item) === c.href ? "page" : undefined}
                          className="block rounded-md px-3 py-2.5 text-base text-ink-foreground/75 hover:bg-white/10 aria-[current=page]:bg-white/10 aria-[current=page]:text-ink-foreground"
                        >
                          {c.label}
                          {c.href === item.href && <Badge n={user.badges?.[item.href]} />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ) : (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className="block rounded-md px-3 py-3 text-base text-ink-foreground/75 hover:bg-white/10 aria-[current=page]:bg-white/10 aria-[current=page]:text-ink-foreground"
                >
                  {item.label}
                  <Badge n={user.badges?.[item.href]} />
                </Link>
              </li>
            ),
          )}
          {user.isDeveloper && (
            <li>
              <button
                type="button"
                aria-expanded={openGroup === "develop"}
                aria-controls="mobile-group-develop"
                onClick={() => setOpenGroup((g) => (g === "develop" ? null : "develop"))}
                className="flex w-full items-center justify-between rounded-md px-3 py-3 text-left text-base text-ink-foreground/75 hover:bg-white/10"
              >
                <span>Develop</span>
                <ChevronIcon className={`transition ${openGroup === "develop" ? "rotate-180" : ""}`} />
              </button>
              {/* Same sub-list as Roster and Sessions above; Reset app data stays red. */}
              {openGroup === "develop" && (
                <ul id="mobile-group-develop" className="ml-4 mt-1 flex flex-col gap-1 border-l border-white/15 pl-2">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setSidebarOpen(false);
                        setResetOpen(true);
                      }}
                      className="block w-full rounded-md px-3 py-2.5 text-left text-base text-red-300 hover:bg-white/10"
                    >
                      Reset app data
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setSidebarOpen(false);
                        setPopulateOpen(true);
                      }}
                      className="block w-full rounded-md px-3 py-2.5 text-left text-base text-ink-foreground/75 hover:bg-white/10"
                    >
                      Populate…
                    </button>
                  </li>
                </ul>
              )}
            </li>
          )}
        </ul>
      </aside>
    </>
  );
}

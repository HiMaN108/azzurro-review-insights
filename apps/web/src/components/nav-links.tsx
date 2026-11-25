"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/insights", label: "Issues & praise" },
  { href: "/reviews", label: "Read reviews" },
  { href: "/ask", label: "Ask" },
];

/** Keeps the hotel filter when switching pages so staff don't have to re-select. */
export function NavLinks() {
  const path = usePathname();
  const sp = useSearchParams();
  const p = sp.get("p");
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={p ? `${l.href}?p=${p}` : l.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

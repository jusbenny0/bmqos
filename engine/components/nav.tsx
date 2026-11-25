"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const items = [
  { href: "/team", label: "Team" },
  { href: "/tasks", label: "Tasks" },
  { href: "/chat", label: "CEO" },
  { href: "/usage", label: "Usage" },
];

function ThemeToggle({ className = "", short }: { className?: string; short?: boolean }) {
  const [t, setT] = useState("light");
  useEffect(() => setT(document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")), []);
  const flip = () => {
    const n = t === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = n; localStorage.setItem("theme", n); setT(n);
  };
  return (
    <button onClick={flip} aria-label="Toggle dark/light mode" className={`rounded-md px-2 py-1.5 text-left text-sm text-[var(--muted)] hover:text-[var(--fg)] ${className}`}>
      {t === "dark" ? "Light" : "Dark"}{!short && " mode"}
    </button>
  );
}

export function Nav() {
  const p = usePathname();
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-52 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-3 md:flex">
        <div className="mb-4 px-2 py-1 text-base font-bold tracking-tight">Crew</div>
        {items.map((i) => (
          <Link key={i.href} href={i.href}
            className={`rounded-md px-2 py-1.5 text-sm ${p.startsWith(i.href) ? "bg-[var(--bg)] font-medium" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}>
            {i.label}
          </Link>
        ))}
        <ThemeToggle className="mt-auto" />
      </aside>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface)] md:hidden">
        {items.map((i) => (
          <Link key={i.href} href={i.href}
            className={`py-3 text-center text-xs ${p.startsWith(i.href) ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}>
            {i.label}
          </Link>
        ))}
        <ThemeToggle className="py-3 text-center text-xs" short />
      </nav>
    </>
  );
}

import type { ReactNode } from "react";
import { Nav } from "@/components/nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:ml-52 md:max-w-none md:px-8 md:pb-10">{children}</main>
    </div>
  );
}

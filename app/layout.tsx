import type { Metadata, Viewport } from "next";
import { company } from "@/lib/config";
import "./fonts.css";
import "./os.css";
import "./shell.css";
import "./social.css";

const base: Metadata = { title: "BMQOS", robots: { index: false, follow: false }, manifest: "/manifest.webmanifest", icons: { apple: "/apple-touch-icon.png" }, appleWebApp: { capable: true, title: "BMQOS", statusBarStyle: "black" } };
export const dynamic = "force-dynamic";
export const generateMetadata = (): Metadata => ({ ...base, title: company()?.name ?? "BMQOS" });
export const viewport: Viewport = { themeColor: "#f4f1ea" };

export default function Root({ children }: { children: React.ReactNode }) {
  const accent = company()?.accent;
  return (
    <html lang="en">
      <body>{accent ? <style>{`html[data-acc="zelena"]{--acc:${accent};--lime:${accent}}`}</style> : null}{children}</body>
    </html>
  );
}

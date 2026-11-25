const TZ = "Europe/Prague";
export const hm = (iso: string): string =>
  new Date(iso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
export const dayKey = (iso: string): string => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
export const dayLbl = (key: string): string => {
  const [, m, d] = key.split("-");
  return `${+d}.${+m}`;
};
export const ago = (min: number): string => {
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 1440) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return m && h < 10 ? `${h} h ${m}` : `${h} h`;
  }
  return `${Math.floor(min / 1440)} d`;
};
export const tok = (n: number): string => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(".", ",")} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
};
export const dur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
// never send tokens, passwords or .env contents out in text
export const scrub = (s: string): string =>
  s
    .replace(/(gh[pousr]_|github_pat_|sk-|xox[bp]-|Bearer\s+)[A-Za-z0-9_\-.]{8,}/g, "$1…")
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)\S+/gi, "$1…");
export const oneLine = (s: string, max = 140): string => {
  const l = scrub(s)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*>]|^#+\s*|\s#{1,6}\s/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return l.length > max ? `${l.slice(0, max - 1)}…` : l;
};
export const hmd = (iso: string): string => {
  const [, m, d] = dayKey(iso).split("-");
  return `${+d}.${+m}. ${hm(iso)}`;
};

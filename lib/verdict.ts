/* Pure logic for reviewing results (no I/O, testable). */
export type Verdict = "projde" | "zmeny" | "neprojde" | "neznamy";
export const GATES = ["Visual Critic", "QA", "Judge", "Code Reviewer", "Security"] as const;

// NEPROJDE (fail) and ZMENY (changes) take precedence over PROJDE (pass) ("not pass" isn't searched for, the verdict is usually the first line)
export const verdictOf = (text: string): Verdict => {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/nepro(jde|slo)|zamitnuto|rejected|\bblok\b/.test(t)) return "neprojde";
  if (/(?<!bez )zmeny|vratit|changes requested/.test(t)) return "zmeny";
  if (/\bprojde\b|prosel|schvaleno|approved|\bok\b/.test(t)) return "projde";
  return "neznamy";
};

export const scoreOf = (text: string): number | null => {
  const m = /(\d{1,2}(?:[.,]\d)?)\s*\/\s*10\b/.exec(text);
  return m ? Number(m[1].replace(",", ".")) : null;
};

const IMG = /https?:\/\/[^\s)>\]"]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)>\]"]*)?/gi;
const SHOT = /(?:^|[\s(`])((?:shots(?:-impl)?|screens?)\/[\w./-]+\.(?:png|jpe?g|webp))/gi;
export const shotsOf = (text: string): string[] => {
  const out = new Set<string>(text.match(IMG) ?? []);
  for (const m of text.matchAll(SHOT)) out.add(m[1]);
  return [...out].slice(0, 12);
};

import "server-only";

// unified secret filter: exact values from env + patterns; apply to audit, output, and errors
const KEY = /KEY|TOKEN|SECRET|PASS|PWD|DSN|PRIVATE/i;
const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "key"],
  [/\b(?:ghp|gho|github_pat|pcp|sk|xox[bp]|AKIA)[-_][A-Za-z0-9_-]{8,}/g, "token"],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "jwt"],
  [/Bearer\s+[\w.~+/=-]{8,}/gi, "bearer"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/gi, "url"],
  [/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASS|PWD|DSN|PRIVATE)[A-Z0-9_]*)\s*[=:]\s*\S{4,}/g, "env"],
];
export const redact = (text: string): string => {
  let out = text;
  for (const [k, v] of Object.entries(process.env)) if (v && v.length >= 8 && KEY.test(k)) out = out.split(v).join("«hidden:env»");
  for (const [re, t] of PATTERNS) out = out.replace(re, `«hidden:${t}»`);
  return out;
};

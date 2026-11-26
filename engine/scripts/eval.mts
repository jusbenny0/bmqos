// Run role evals: npm run eval [-- <role>] [--repeat N]
import { evalRoles, runEvals } from "../lib/evals.ts";
const args = process.argv.slice(2);
const ri = args.indexOf("--repeat");
const repeat = ri >= 0 ? Number(args[ri + 1]) || 1 : 1;
const roles = args.filter((a, i) => !a.startsWith("--") && (ri < 0 || i !== ri + 1));
let failed = 0;
for (const role of roles.length ? roles : evalRoles()) {
  const r = await runEvals(role, { repeat, label: "cli" });
  console.log(`${role}: ${r.passed}/${r.total}`);
  for (const x of r.results) if (!x.pass) { failed++; console.log(`  FAIL ${x.id}: ${x.why}`); }
}
process.exit(failed && process.env.EVAL_STRICT ? 1 : 0);

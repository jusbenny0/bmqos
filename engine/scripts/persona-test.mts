// Unit checks for personalities: prompt order (persona -> role instructions -> lessons), truncation, validation, presets.
import assert from "node:assert/strict";
import { addLesson } from "../lib/retro.ts";
import { PERSONA_MAX, listPresets, loadPreset, parsePersona, personaBlock, personaOf, withPersona, DEFAULT_TEAM } from "../lib/config.ts";

const p = loadPreset("careful-senior")!;
const prompt = withPersona(p, addLesson("You are a builder. Do the work.", "run tsc first"));
const [a, b, c] = ["Personality:", "You are a builder", "Lessons (learned"].map((s) => prompt.indexOf(s));
assert.ok(a === 0 && b > a && c > b, "order: persona, role instructions, lessons");
assert.equal(withPersona(null, "x"), "x", "no persona, no change");

const long = { tone: "t".repeat(400), values: ["v".repeat(300)], avoid: ["a"] };
const block = personaBlock(long).trimEnd();
assert.ok(block.length <= PERSONA_MAX && block.endsWith("…"), "truncated");

assert.equal(parsePersona({ tone: "x", values: [1], avoid: [] }), null);
assert.equal(parsePersona("nope"), null);
assert.equal(personaOf("{bad"), null);
assert.deepEqual(personaOf(JSON.stringify(p)), parsePersona(p));

assert.deepEqual(listPresets(), ["careful-senior", "fast-pragmatist", "friendly-explainer", "strict-reviewer"]);
assert.ok(DEFAULT_TEAM.every((r) => r.persona), "default team has personas");
assert.equal(DEFAULT_TEAM.find((r) => r.role === "reviewer")!.persona!.name, "Strict reviewer");
console.log("persona-test: ok");

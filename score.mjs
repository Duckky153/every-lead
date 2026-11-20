// Re-scores Jev's saved answers (and the simple-rules baseline) against the answer keys; writes site/data/scores.json.
// Run: node score.mjs   (no key, no network: it reads the saved run)
import fs from "node:fs";
import { runDay, score, perfectAnswers } from "./site/engine.js";

const d = (f) => JSON.parse(fs.readFileSync(new URL(`./site/data/${f}`, import.meta.url)));
const config = { questions: d("questions.json"), rules: d("rules.json"), checks: d("checks.json"), wording: d("wording.json") };
const leads = d("leads.json").leads;
const pk = Object.fromEntries(leads.map((l) => [l.id, d("problem-key.json")[l.id]]));
const rk = d("reading-key.json");
const closed = d("closed.json").closed || {};
const jev = d("jev-answers.json");

const expected = runDay(config, leads, Object.fromEntries(leads.map((l) => [l.id, perfectAnswers(rk[l.id])])), { closed });
const day = runDay(config, leads, jev.answers, { meta: jev.per_lead, closed });
const s = score(config, day, pk, rk, expected);

let baseline = null;
if (fs.existsSync(new URL("./site/data/baseline-answers.json", import.meta.url))) {
  const b = d("baseline-answers.json");
  const bday = runDay(config, leads, b.answers, { closed });
  const bs = score(config, bday, pk, rk, expected);
  baseline = { note: b.note, jev: bs.jev, false_alarms: bs.false_alarms.length, reading_totals: bs.reading_totals, lead_level: { same: bs.lead_level.same, total: bs.lead_level.total } };
}

// Jev's reading against the key as it was locked (before the logged L030 key fix).
const lockedKey = JSON.parse(JSON.stringify(rk));
for (const c of (d("lock-changes.json").changes || []).filter((c) => c.key_changes)) for (const k of c.key_changes) lockedKey[k.lead][k.question] = k.locked;
const atLock = score(config, day, pk, lockedKey).reading_totals;

// Lead level under the lane rule in use when Jev read the 100 leads (engine.js at private commit 658fd8e), recomputed
// on 2026-11-20 with the same saved answers. The lane rule changed after the run (CHANGES.md, round 3).
const leadLevelOriginalRule = { jev: 96, baseline: 68, total: 100, engine_commit: "658fd8e" };

const out = { note: "Scored on planted, made-up problems. Real accuracy needs real leads.",
  run: { model: jev.run.model_asked, date: jev.run.started.slice(0, 10), questions: jev.run.question_version },
  lanes: day.summary, ...s, reading_totals_locked_key: atLock, baseline, lead_level_original_rule: leadLevelOriginalRule };
fs.writeFileSync(new URL("./site/data/scores.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`code ${s.code.caught}/${s.code.total} (a test), Jev ${s.jev.caught}/${s.jev.total}, missed in Go now ${s.missed_in_go_now}, false alarms ${s.false_alarms.length}, slowed ${s.slowed.length}, lead level ${s.lead_level.same}/${s.lead_level.total}; reading ${s.reading_totals.right}/700 (locked key ${atLock.right}); baseline ${baseline ? `${baseline.jev.caught}/${baseline.jev.total}, ${baseline.false_alarms} false, reading ${baseline.reading_totals.right}/700, lead level ${baseline.lead_level.same}` : "none"}; lanes ${JSON.stringify(day.summary)}`);

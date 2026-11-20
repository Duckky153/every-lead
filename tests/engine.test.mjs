// Tests for Every Lead's engine: the checks, lanes, steps, handoff cards, messages and evals.
// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { runDay, runChecks, readAnswers, perfectAnswers, score, pickLane, checkReply } from "../site/engine.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../site/data/${f}`, import.meta.url)));
const config = { questions: read("questions.json"), rules: read("rules.json"), checks: read("checks.json"), wording: read("wording.json") };
const leads = read("leads.json").leads;
const readingKey = read("reading-key.json");
const problemKey = read("problem-key.json");
const scoredKey = Object.fromEntries(leads.map((l) => [l.id, problemKey[l.id]]));
const perfect = Object.fromEntries(leads.map((l) => [l.id, perfectAnswers(readingKey[l.id])]));
const SAVED = fs.existsSync(new URL("../site/data/jev-answers.json", import.meta.url)) ? read("jev-answers.json") : null;

const cleanAnswers = (over = {}) => ({ ...perfectAnswers({
  what_business: "building_trades", who_is_writing: "owner_or_officer", asks_coverage_question: "no", timing: "not_stated",
  employees_in_text: "not_stated", spam_or_test: "no", instructions_in_text: "no" }), ...over });
const baseLead = { id: "T1", came_in: "09:00", source: "phone_call", business: "Test Roofing", contact: "Ana Test", phone: "(512) 555-0101",
  email: "ana@example.com", state: "TX", industry_picked: "Roofing", coverage_wanted: ["General liability"], employees: 5, sms_consent: null,
  needed_by: null, renews: null, partner: null, what_they_wrote: "We do roofing." };
const flagsFor = (lead, answers, earlier = [], fixes = {}) => runChecks(config, lead, earlier, readAnswers(config, answers), fixes).flags.map((f) => f.check);

test("rules on the right answers find all 44 planted problems with 0 false flags", () => {
  const day = runDay(config, leads, perfect);
  const s = score(config, day, scoredKey, readingKey);
  assert.equal(s.code.caught, 15); assert.equal(s.code.total, 15);
  assert.equal(s.jev.caught, 29); assert.equal(s.jev.total, 29);
  assert.deepEqual(s.false_alarms, []);
  assert.equal(s.slowed.length, 0);
  assert.deepEqual(day.summary.go_now + day.summary.check_first + day.summary.fix_first, 100);
  assert.equal(day.summary.go_now, 81); assert.equal(day.summary.check_first, 4); assert.equal(day.summary.fix_first, 15);
  assert.equal(day.summary.go_now_with_questions, 21);
});

test("phone checks: missing, 9 digits and letters fail; a full number passes", () => {
  for (const phone of ["", "(512) 555-010", "(512) 555-01O1"]) assert.deepEqual(flagsFor({ ...baseLead, phone }, cleanAnswers()), ["phone_broken"]);
  assert.deepEqual(flagsFor(baseLead, cleanAnswers()), []);
});

test("no working contact: a number in the note goes to a teammate; none is held", () => {
  const lead = { ...baseLead, phone: "", email: "ana@" };
  const withNote = runChecks(config, { ...lead, what_they_wrote: "Call 512-555-0144." }, [], readAnswers(config, cleanAnswers())).flags;
  assert.equal(withNote[0].owner, "Teammate can fix");
  const none = runChecks(config, lead, [], readAnswers(config, cleanAnswers())).flags;
  assert.equal(none[0].held, true);
});

test("duplicates: same phone, same email or a name one letter apart in the same state, earlier only", () => {
  const first = { ...baseLead, id: "T0", business: "Ridgeline Roofing LLC", phone: "(512) 555-0199", email: "x@example.com" };
  assert.ok(flagsFor({ ...baseLead, business: "Ridgline Roofing LLC" }, cleanAnswers(), [first]).includes("duplicate"));
  assert.ok(flagsFor({ ...baseLead, phone: first.phone }, cleanAnswers(), [first]).includes("duplicate"));
  assert.ok(!flagsFor({ ...baseLead, business: "Ridgline Roofing LLC", state: "GA" }, cleanAnswers(), [first]).includes("duplicate"));
  assert.ok(!flagsFor({ ...baseLead, business: "Ridgline Roofing LLC" }, cleanAnswers(), []).includes("duplicate"));
});

test("headcount bucket edges: 2 to 10 accepts 1 to 13", () => {
  const a = cleanAnswers({ employees_in_text: { choice: "2_to_10", confidence: 0.9, probabilities: {} } });
  assert.deepEqual(flagsFor({ ...baseLead, employees: 13 }, a), []);
  assert.deepEqual(flagsFor({ ...baseLead, employees: 14 }, a), ["headcount_mismatch"]);
});

test("business type: a different group is flagged for a licensed person; the same group is not", () => {
  const food = cleanAnswers({ what_business: { choice: "food_drink", confidence: 0.9, probabilities: {} } });
  const f = runChecks(config, baseLead, [], readAnswers(config, food)).flags;
  assert.equal(f[0].check, "industry_mismatch"); assert.equal(f[0].owner, "Licensed person");
  assert.deepEqual(flagsFor({ ...baseLead, industry_picked: "Food truck or catering" }, food), []);
});

test("each question's unsure answer falls as questions.json says; with no working phone, questions go into a message", () => {
  const laneFor = (lead, over) => pickLane(config, runChecks(config, lead, [], readAnswers(config, cleanAnswers(over))).flags, lead);
  const lane = (over) => laneFor(baseLead, over);
  assert.equal(laneFor({ ...baseLead, phone: "" }, { asks_coverage_question: { noul: 0.95 } }), "fix_first");
  assert.equal(lane({}), "go_now");
  assert.equal(lane({ what_business: { choice: "building_trades", confidence: 0.5, probabilities: {} } }), "check_first");
  assert.equal(lane({ asks_coverage_question: { noul: 0.5 } }), "go_now"); // a first-call step for the licensed agent
  assert.equal(lane({ instructions_in_text: { noul: 0.5 } }), "check_first");
  assert.equal(lane({ spam_or_test: { noul: 0.5 } }), "go_now");
  assert.equal(lane({ who_is_writing: { choice: "staff_sent_by_someone_else", confidence: 0.5, probabilities: {} } }), "go_now");
  assert.equal(lane({ employees_in_text: { choice: "over_50", confidence: 0.5, probabilities: {} } }), "go_now");
  assert.equal(lane({ timing: { choice: "right_away", confidence: 0.5, probabilities: {} } }), "go_now");
  // Replacing a confident "no problem" with unsure never moves a lead to a faster lane.
  const rank = { go_now: 0, fix_first: 1, check_first: 2 };
  for (const [q, spec] of Object.entries(config.questions.questions)) {
    const unsure = spec.type === "noul" ? { noul: 0.5 } : { choice: cleanAnswers()[q].choice, confidence: 0.5, probabilities: {} };
    assert.ok(rank[lane({ [q]: unsure })] >= rank[lane({})], q);
  }
});

test("a reply that fails the checks goes to a person, never a drop", () => {
  assert.equal(checkReply(config, { what_business: { choice: "nonsense", confidence: 1 } }), null);
  const day = runDay(config, [baseLead], { T1: { broken: true } });
  assert.equal(day.results[0].lane, "check_first");
  assert.equal(day.summary.dropped_by_tool, 0);
  assert.ok(day.results[0].steps.some((s) => s.text.startsWith("Jev did not read it")));
});

test("every lead is in exactly one lane; every flag has an owner; dropped by the tool is 0", () => {
  const day = runDay(config, leads, perfect);
  const ids = day.results.map((r) => r.id);
  assert.equal(new Set(ids).size, 100);
  for (const r of day.results) {
    assert.ok(["go_now", "check_first", "fix_first"].includes(r.lane));
    for (const f of r.flags) assert.ok(f.owner && f.fix, `${r.id} ${f.check}`);
  }
  assert.equal(day.summary.dropped_by_tool, 0);
  assert.equal(day.summary.closed_by_person, 0);
});

test("Go now order: urgent first (soonest need first), then longest wait; one to three steps shown, the first always confirms", () => {
  const day = runDay(config, leads, perfect);
  const go = day.go_now_order.map((id) => day.results.find((r) => r.id === id));
  const firstCalm = go.findIndex((r) => !r.urgent);
  assert.ok(go.slice(firstCalm).every((r) => !r.urgent));
  const due = (r) => (r.urgent_why === "date" ? r.lead.needed_by : "2026-11-19");
  for (let i = 1; i < firstCalm; i++) assert.ok(due(go[i]) >= due(go[i - 1]));
  for (let i = firstCalm + 1; i < go.length; i++) assert.ok(go[i].lead.came_in >= go[i - 1].lead.came_in);
  for (const r of go) assert.equal(r.next_steps[0], config.wording.next_steps.confirm);
});

test("renewal follow-up is 60 days before the form's renewal date, never an invented date", () => {
  const lead = { ...baseLead, renews: "2027-03-01" };
  const day = runDay(config, [lead], { T1: cleanAnswers() });
  assert.ok(day.results[0].next_steps.some((s) => s.includes("Dec 31")));
});

test("Fill in the fix closes a flag only when the check now passes; licensed flags need a name", () => {
  const broken = { ...baseLead, phone: "(512) 555-010" };
  assert.deepEqual(flagsFor(broken, cleanAnswers(), [], { phone: "(512) 555-01" }), ["phone_broken"]);
  assert.deepEqual(flagsFor(broken, cleanAnswers(), [], { phone: "(512) 555-0102" }), []);
  const q = cleanAnswers({ asks_coverage_question: { noul: 0.95 } });
  assert.deepEqual(flagsFor(baseLead, q), ["coverage_question"]);
  assert.deepEqual(flagsFor(baseLead, q, [], { coverage_replied_by: "" }), ["coverage_question"]);
  assert.deepEqual(flagsFor(baseLead, q, [], { coverage_replied_by: "Jo (licensed)" }), []);
});

test("messages ask only for what's missing, with no placeholders; wording rules hold everywhere", () => {
  const day = runDay(config, leads, perfect);
  const banned = config.wording.banned;
  const texts = [];
  for (const r of day.results) {
    if (r.message) {
      assert.ok(!/\{\w+\}/.test(r.message.text), r.id);
      const wanted = r.flags.filter((f) => f.owner === "Ask the customer" && f.ask && !f.held).map((f) => f.ask);
      assert.deepEqual(r.message.items, wanted);
      texts.push(r.message.text);
    }
    if (r.card) texts.push(...r.card.wrong, ...r.card.fixes, r.card.when_back);
    texts.push(...r.next_steps, ...r.steps.map((s) => s.text));
  }
  const pattern = (b) => new RegExp(/^[\w ]+$/.test(b) ? `\\b${b}\\b` : b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  for (const t of texts) for (const b of banned) assert.ok(!pattern(b).test(t), `"${b}" in: ${t}`);
});

test("Steps: start with Arrived, end with one Next or Closed line; only Jev's line is MODEL; no invented times", () => {
  const day = runDay(config, leads, perfect);
  for (const r of day.results) {
    const s = r.steps;
    assert.ok(s[0].text.startsWith(`Arrived ${r.lead.came_in}`));
    const last = s[s.length - 1];
    assert.ok(last.label === "NEXT" || last.label === "PERSON");
    assert.equal(s.filter((x) => x.label === "NEXT").length + s.filter((x) => x.label === "PERSON").length, 1);
    assert.deepEqual(s.filter((x) => x.label === "MODEL").length, 1);
    assert.ok(s.every((x) => x.label !== "PERSON") || r.closed);
    for (const x of s.slice(1)) assert.ok(!/\b\d{1,2}:\d{2}\b/.test(x.text), `time in ${x.text}`);
  }
  assert.deepEqual(runDay(config, leads, perfect).results.map((r) => r.steps), day.results.map((r) => r.steps));
});

test("handoff cards: on every Fix first and Check first lead, never on Go now", () => {
  const day = runDay(config, leads, perfect);
  for (const r of day.results) {
    if (r.lane === "go_now") assert.equal(r.card, null);
    else {
      assert.ok(r.card.waiting_for && r.card.wrong.length && r.card.when_back, r.id);
      if (r.lane === "fix_first") assert.ok(r.card.fixes.every((f) => f && f.length > 5), r.id);
    }
  }
});

test("closed by a person counts only what closed.json says", () => {
  const closed = read("closed.json").closed || {};
  const day = runDay(config, leads, perfect, { closed });
  assert.equal(day.summary.closed_by_person, Object.keys(closed).length);
  for (const id of Object.keys(closed)) assert.ok(day.results.find((r) => r.id === id).steps.some((s) => s.label === "PERSON"));
});

test("every clean lead out of Go now is counted exactly once: false alarm or slowed", () => {
  const answers = SAVED ? SAVED.answers : perfect;
  const day = runDay(config, leads, answers);
  const s = score(config, day, scoredKey, readingKey);
  const clean = leads.filter((l) => scoredKey[l.id].length === 0);
  const out = clean.filter((l) => day.results.find((r) => r.id === l.id).lane !== "go_now").map((l) => l.id);
  const fa = new Set(s.false_alarms.map((f) => f.id));
  const sl = new Set(s.slowed.map((x) => x.id));
  for (const id of out) assert.ok(fa.has(id) !== sl.has(id), id);
});

test("saved scores match a fresh scoring of the saved answers", { skip: !SAVED }, () => {
  const saved = read("scores.json");
  const day = runDay(config, leads, SAVED.answers);
  const s = score(config, day, scoredKey, readingKey);
  assert.equal(saved.jev.caught, s.jev.caught);
  assert.equal(saved.false_alarms.length, s.false_alarms.length);
  assert.equal(saved.slowed.length, s.slowed.length);
});

test("locked files match their fingerprints, or every change is logged", { skip: !SAVED || !SAVED.run.locked }, () => {
  const changes = read("lock-changes.json").changes || [];
  for (const [f, fp] of Object.entries(SAVED.run.locked.files)) {
    const now = crypto.createHash("sha256").update(fs.readFileSync(new URL(`../${f}`, import.meta.url))).digest("hex");
    let want = fp;
    for (const c of changes.filter((c) => c.file === f)) { assert.equal(c.before, want, `${f} change chain`); want = c.after; }
    assert.equal(now, want, `${f} changed after the lock without a logged change`);
  }
});

test("saved answers are not stale: the questions and lead text match the run's fingerprints", { skip: !SAVED }, () => {
  const q = config.questions;
  const qs = {};
  for (const [id, x] of Object.entries(q.questions)) qs[id] = x.type === "choice" ? { type: x.type, instructions: x.instructions, criteria: x.criteria } : { type: x.type, instructions: x.instructions };
  const fp = crypto.createHash("sha256").update(JSON.stringify(sortKeys(qs))).digest("hex");
  assert.equal(SAVED.run.question_version, q.version);
  assert.equal(fp, SAVED.run.questions_fingerprint);
  // The lead text must match the latest read (the scored run, or the latest logged re-read).
  const states = leads.map((l) => ({ lead: { business_name: l.business, what_they_wrote: l.what_they_wrote } }));
  const leadsFp = crypto.createHash("sha256").update(JSON.stringify(sortKeys(states))).digest("hex");
  assert.equal(leadsFp, SAVED.run.leads_fingerprint_current, "lead text changed since Jev last read it");
});

function sortKeys(o) {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (o && typeof o === "object") return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  return o;
}

test("on Jev's real day too: wording rules, Steps shape and handoff cards hold for every lead", { skip: !SAVED }, () => {
  const day = runDay(config, leads, SAVED.answers, { meta: SAVED.per_lead });
  const pattern = (b) => new RegExp(/^[\w ]+$/.test(b) ? `\\b${b}\\b` : b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  for (const r of day.results) {
    const texts = [...r.next_steps, ...r.steps.map((s) => s.text)];
    if (r.message) texts.push(r.message.text);
    if (r.card) texts.push(...r.card.wrong, ...r.card.fixes, r.card.when_back);
    for (const t of texts) for (const b of config.wording.banned) assert.ok(!pattern(b).test(t), `${r.id}: "${b}" in ${t}`);
    assert.equal(r.steps.filter((s) => s.label === "MODEL").length, 1, r.id);
    assert.ok(["NEXT", "PERSON"].includes(r.steps[r.steps.length - 1].label), r.id);
    if (r.lane === "go_now") assert.equal(r.card, null);
    else assert.ok(r.card.waiting_for && r.card.wrong.length, r.id);
  }
});

test("messages name exactly the customer's missing items, in the wording file's words", () => {
  const day = runDay(config, leads, perfect);
  for (const r of day.results) {
    const want = scoredKey[r.id].filter((p) => p.owner === "Ask the customer" && p.kind !== "no_working_contact:none")
      .map((p) => config.wording.checks[p.kind].ask).filter(Boolean);
    if (!r.message) { assert.ok(want.length === 0 || r.lane !== "fix_first" || !r.lead.email && !r.lead.phone, r.id); continue; }
    assert.deepEqual([...r.message.items].sort(), [...want].sort(), r.id);
  }
});

test("a merged duplicate leaves the lanes and never goes to Go now", () => {
  const dup = leads.find((l) => scoredKey[l.id].some((p) => p.kind === "duplicate") && scoredKey[l.id].length === 1);
  const day = runDay(config, leads, perfect, { fixes: { [dup.id]: { merged: true } } });
  const r = day.results.find((x) => x.id === dup.id);
  assert.equal(r.lane, "merged");
  assert.ok(!day.go_now_order.includes(dup.id));
  assert.ok(r.steps.some((s) => s.text.startsWith("Merged into")));
});

test("a licensed agent's confirmed type closes the business-type flag (their call wins over the model); a name is required", () => {
  const food = cleanAnswers({ what_business: { choice: "food_drink", confidence: 0.9, probabilities: {} } });
  assert.deepEqual(flagsFor(baseLead, food, [], { licensed_by: "Jo", confirmed_group: "retail_shop" }), []);
  assert.deepEqual(flagsFor(baseLead, food, [], { licensed_by: "1", confirmed_group: "retail_shop" }), ["industry_mismatch"]);
  assert.deepEqual(flagsFor(baseLead, food, [], { licensed_by: "Jo", confirmed_group: "food_drink" }), []);
  assert.deepEqual(flagsFor(baseLead, food, [], { confirmed_group: "food_drink" }), ["industry_mismatch"]);
});

test("the headcount check isn't listed as passed on a form that doesn't ask it", () => {
  const r = runChecks(config, { ...baseLead, employees: null, source: "web_form" }, [], readAnswers(config, cleanAnswers()));
  assert.ok(!r.passed.includes("Headcount agrees"));
});

test("phones in any common format work; letters or too few digits fail", () => {
  for (const phone of ["(512) 555-0101", "512-555-0101", "5125550101", "+1 512 555 0101", "1-512-555-0101"]) assert.deepEqual(flagsFor({ ...baseLead, phone }, cleanAnswers()), [], phone);
  for (const phone of ["512-555-010", "512-555-01O1", "555-0101"]) assert.deepEqual(flagsFor({ ...baseLead, phone }, cleanAnswers()), ["phone_broken"], phone);
});

test("a number in the note is found in common formats", () => {
  for (const note of ["Call (512) 555-0144.", "text me 512.555.0144", "my cell is 5125550144"]) {
    const f = runChecks(config, { ...baseLead, phone: "", email: "ana@", what_they_wrote: note }, [], readAnswers(config, cleanAnswers())).flags;
    assert.equal(f[0].owner, "Teammate can fix", note);
  }
});

test("duplicate names: suffixes ignored, one letter apart only for longer names that start the same", () => {
  const first = { ...baseLead, id: "T0", phone: "(512) 555-0199", email: "x@example.com" };
  const dup = (a, b) => flagsFor({ ...baseLead, business: b }, cleanAnswers(), [{ ...first, business: a }]).includes("duplicate");
  assert.ok(dup("Ortega Services LLC", "Ortega Services"));
  assert.ok(dup("Ridgeline Roofing LLC", "Ridgline Roofing LLC"));
  assert.ok(!dup("Joe's Pizza", "Moe's Pizza"));
  assert.ok(!dup("!!!", ""));
  assert.ok(flagsFor({ ...baseLead, phone: "512-555-0199" }, cleanAnswers(), [first]).includes("duplicate"), "same phone, other format");
});

test("Fill in the fix rejects bad values: a headcount must be a whole number, a sign-off needs a name", () => {
  const a = cleanAnswers({ employees_in_text: { choice: "11_to_50", confidence: 0.9, probabilities: {} } });
  const lead = { ...baseLead, employees: 3 };
  assert.deepEqual(flagsFor(lead, a, [], { employees: "about 30" }), ["headcount_mismatch"]);
  assert.deepEqual(flagsFor(lead, a, [], { employees: "30" }), []);
  const who = cleanAnswers({ who_is_writing: { choice: "staff_sent_by_someone_else", confidence: 0.9, probabilities: {} } });
  assert.deepEqual(flagsFor(baseLead, who, [], { decision_maker: "?" }), ["not_decision_maker"]);
});

test("a merge after typing a phone still merges, and the earlier lead keeps the duplicate's urgency", () => {
  const first = { ...baseLead, id: "T0", came_in: "08:00", phone: "(512) 555-0199", email: "a@example.com", business: "Alpha Roofing" };
  const second = { ...baseLead, id: "T1", came_in: "09:00", phone: "", email: "b@example.com", business: "Beta Roofing", needed_by: "2026-11-20" };
  const ans = { T0: cleanAnswers(), T1: cleanAnswers() };
  const day = runDay(config, [first, second], ans, { fixes: { T1: { phone: "512-555-0199", merged: true } } });
  assert.equal(day.results[1].lane, "merged");
  assert.ok(day.results[0].urgent && day.results[0].next_steps.some((s) => s.includes("merged in from T1")));
  assert.equal(day.summary.dropped_by_tool, 0);
});

test("score(): crafted cases count catches, misses, false alarms and slowed leads correctly", () => {
  const leadsX = ["A", "B", "C"].map((id, i) => ({ ...baseLead, id, business: `${id}lpha Works ${i}`, phone: `(512) 555-011${i}`, email: `${id}@example.com` }));
  const ans = { A: cleanAnswers({ asks_coverage_question: { noul: 0.95 } }), B: cleanAnswers(), C: cleanAnswers({ what_business: { choice: "building_trades", confidence: 0.4, probabilities: {} } }) };
  const day = runDay(config, leadsX, ans);
  const pkX = { A: [{ kind: "coverage_question", owner: "Licensed person" }], B: [{ kind: "spam", owner: "A person reads it" }], C: [] };
  const rkX = Object.fromEntries(leadsX.map((l) => [l.id, readingKeyFor()]));
  const s = score(config, day, pkX, rkX);
  assert.equal(s.jev.caught, 1); assert.equal(s.jev.total, 2);
  assert.equal(s.missed[0].id, "B");
  assert.deepEqual(s.slowed.map((x) => x.id), ["C"]);
  assert.equal(s.false_alarms.length, 0);
});

function readingKeyFor() {
  return { what_business: "building_trades", who_is_writing: "owner_or_officer", asks_coverage_question: "no", timing: "not_stated", employees_in_text: "not_stated", spam_or_test: "no", instructions_in_text: "no" };
}

test("every lead's text is exactly what Jev last read (per-lead fingerprints)", { skip: !SAVED }, () => {
  for (const l of leads) {
    const state = { lead: { business_name: l.business, what_they_wrote: l.what_they_wrote } };
    const fp = crypto.createHash("sha256").update(JSON.stringify(sortKeys(state))).digest("hex");
    assert.equal(fp, SAVED.per_lead[l.id].text_fingerprint, `${l.id} changed since Jev last read it`);
  }
});

test("merge carry-over: an urgent duplicate makes the earlier lead urgent without breaking the order", () => {
  const mk = (id, t, extra) => ({ ...baseLead, id, came_in: t, business: { A1: "Maple Roofing", A2: "Granite Plumbing", A3: "Cedar Electric" }[id], phone: `(512) 555-01${id.slice(1).padStart(2, "0")}`, email: `${id}@example.com`, ...extra });
  const leadsX = [mk("A1", "08:00", { needed_by: "2026-11-22" }), mk("A2", "08:30", {}), mk("A3", "09:00", { needed_by: "2026-11-21", phone: "(512) 555-0102" })];
  const ans = Object.fromEntries(leadsX.map((l) => [l.id, cleanAnswers()]));
  const day = runDay(config, leadsX, ans, { fixes: { A3: { merged: true } } });
  assert.equal(day.results[2].lane, "merged");
  assert.deepEqual(day.go_now_order, ["A2", "A1"]);
});

test("the business type a customer gives is checked against the type they picked", () => {
  const vague = cleanAnswers({ what_business: { choice: "cannot_tell", confidence: 0.9, probabilities: {} } });
  assert.deepEqual(flagsFor(baseLead, vague, [], { business_described: "building_trades" }), []);
  assert.deepEqual(flagsFor(baseLead, vague, [], { business_described: "food_drink" }), ["industry_mismatch"]);
});

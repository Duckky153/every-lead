// The "How it works" page: fills every number from the saved run (so the write-up can't drift from the page),
// and draws two looping figures. Each figure is a pure function of time, so a frame looks the same every time.
import { runDay } from "./engine.js";
import { morning, MORNING, sorter, SORT } from "./figs.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const prog = (t, a, b) => ease(clamp((t - a) / (b - a)));
const show = (el, o, dy = 0) => { el.style.opacity = o; el.style.transform = `translateY(${(1 - o) * dy}px)`; el.style.visibility = o > 0.01 ? "visible" : "hidden"; };

async function getJSON(name) {
  const r = await fetch(`data/${name}`);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}

// ---------- numbers ----------
function fillNumbers(day, scores) {
  const s = day.summary;
  const planted = Object.values(scores.planted_by_lead || {}).length;
  const nums = {
    total: s.total, go_now: s.go_now, go_now_with_questions: s.go_now_with_questions, fix_first: s.fix_first, check_first: s.check_first,
    jev_caught: scores.jev.caught, jev_total: scores.jev.total, jev_false: scores.false_alarms.length,
    base_caught: scores.baseline ? scores.baseline.jev.caught : "", base_false: scores.baseline ? scores.baseline.false_alarms : "",
    planted_leads: planted || 40, rereads: scores.rereads,
  };
  for (const el of $$("[data-num]")) if (el.dataset.num in nums) el.textContent = String(nums[el.dataset.num]);
  const maxFalse = Math.max(nums.jev_false, Number(nums.base_false) || 0, 1);
  const bars = {
    jev_caught: nums.jev_caught / nums.jev_total, base_caught: (Number(nums.base_caught) || 0) / nums.jev_total,
    jev_false: nums.jev_false / maxFalse, base_false: (Number(nums.base_false) || 0) / maxFalse,
  };
  for (const el of $$("[data-bar]")) el.style.width = `${Math.max(2, 100 * (bars[el.dataset.bar] || 0))}%`;
}

// ---------- running the figures ----------
function runLoop(figure, draw, period) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const still = new URLSearchParams(location.search).get("still");
  // A still frame (and the reduced-motion view) shows the finished state, before the loop's closing fade.
  if (still) { draw(Math.min(Number(still), period - 0.6)); return; }
  if (reduce) { draw(period - 0.6); return; }
  let visible = false, t0 = null;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.2 }).observe(figure);
  const tick = (now) => {
    if (visible) { if (t0 === null) t0 = now; draw(((now - t0) / 1000) % period); }
    requestAnimationFrame(tick);
  };
  draw(0);
  requestAnimationFrame(tick);
}

async function main() {
  const [questions, rules, checks, wording, leadsFile, jev, scores, problemKey] = await Promise.all([
    getJSON("questions.json"), getJSON("rules.json"), getJSON("checks.json"), getJSON("wording.json"), getJSON("leads.json"),
    getJSON("jev-answers.json"), getJSON("scores.json"), getJSON("problem-key.json")]);
  const config = { questions, rules, checks, wording };
  const leads = leadsFile.leads;
  const day = runDay(config, leads, jev.answers, { meta: jev.per_lead });
  scores.rereads = new Set((jev.run.rereads || []).flatMap((x) => x.leads)).size;
  scores.planted_by_lead = Object.fromEntries(leads.filter((l) => (problemKey[l.id] || []).length).map((l) => [l.id, true]));
  fillNumbers(day, scores);
  // The lead the morning figure follows: its real drafted message, and its place in Go now once the number is in.
  const demo = day.results.find((r) => r.id === "L005");
  const after = runDay(config, leads, jev.answers, { meta: jev.per_lead, fixes: { L005: { phone: "(904) 555-0162" } } }).results.find((r) => r.id === "L005");
  runLoop($("#fig-morning"), morning($("#mf-morning"), { lead: demo.lead, message: demo.message.text, rankAfter: after.rank }), MORNING);
  runLoop($("#fig-sort"), sorter($("#mf-sort"), day.results), SORT);
}

main().catch((e) => { console.error(e); });

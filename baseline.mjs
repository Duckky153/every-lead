// A yardstick for Jev: simple keyword rules (plus the form's "role" box) answering the same 7 questions, no model.
// Written after seeing the leads, so it is a rough and generous yardstick, not a fair contest.
// Run: node baseline.mjs   -> site/data/baseline-answers.json (no key, no network)
import fs from "node:fs";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`./site/data/${f}`, import.meta.url)));
const leads = read("leads.json").leads;

const GROUPS = [
  ["building_trades", /roof|plumb|hvac|heating|furnace|electric|contractor|remodel|construct|drywall|concrete|paving|framing|handyman/],
  ["landscaping_outdoor", /lawn|landscap|tree|snow|mow|yard|garden/],
  ["cleaning", /clean|janitor|maid|pressure wash/],
  ["food_drink", /restaurant|cafe|café|bakery|food truck|cater|taco|coffee|kitchen|bar\b|brew|pizza|deli/],
  ["retail_shop", /\bstore\b|boutique|retail|\bshop\b(?! work)/],
  ["office_professional", /consult|account|bookkeep|tax prep|cpa|payroll for/],
  ["personal_care", /salon|barber|spa\b|nail|groom/],
  ["auto_repair", /auto|garage|brake|mechanic|body shop|tire|transmission/],
  ["transport_delivery", /truck|deliver|courier|moving|freight|haul/],
  ["tech_creative", /software|web|design|marketing|photo|video|\bapp\b|studio|seo/],
];

function bucket(n) {
  if (n <= 1) return "owner_only";
  if (n <= 10) return "2_to_10";
  if (n <= 50) return "11_to_50";
  return "over_50";
}

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function answers(lead) {
  const text = `${lead.business} ${lead.what_they_wrote}`.toLowerCase();
  const note = lead.what_they_wrote.toLowerCase();
  const role = String(lead.role_typed || "").toLowerCase();
  const pick = (v) => ({ choice: v, confidence: 1, probabilities: { [v]: 1 } });
  const yes = (b) => ({ noul: b ? 1 : 0 });
  const group = (GROUPS.find(([, re]) => re.test(text)) || ["cannot_tell"])[0];
  let who = "cannot_tell";
  if (/owner|ceo|president|founder/.test(role) || /\bi own\b|\bowner\b|co-own|my (shop|business|company)/.test(note)) who = "owner_or_officer";
  if (/manager|assistant|bookkeeper|admin|office/.test(role)) who = "staff_sent_by_someone_else";
  if (/(dad|mom|mother|father|brother|sister|wife|husband|son|daughter|uncle|aunt)'?s? business/.test(role + " " + note)) who = "someone_outside";
  const cover = /\?/.test(note) && /(cover|need|required|protect|cost|how much|price)/.test(note);
  let timing = "not_stated";
  if (/renew/.test(note)) timing = "has_policy_renewing_later";
  if (/asap|today|tomorrow|this week|monday|tuesday|wednesday|thursday|friday|right away|urgent/.test(note)) timing = "right_away";
  let emp = "not_stated";
  const m = note.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(people|employees|guys|techs|drivers|staff|of us|workers|crew)/);
  if (m) emp = bucket(WORDS[m[1]] || Number(m[1]));
  if (/just me\b|only me\b|by myself|one-person/.test(note)) emp = "owner_only";
  const spam = /\bseo\b|reply yes|free audit|page one of google|grow your agency|five-star reviews/.test(note);
  const orders = /ignore (your|all|the)|ai (assistant|reading)|mark (this|my) lead|top priority|skip the/.test(note);
  return {
    what_business: pick(group), who_is_writing: pick(who), asks_coverage_question: yes(cover), timing: pick(timing),
    employees_in_text: pick(emp), spam_or_test: yes(spam), instructions_in_text: yes(orders),
  };
}

const out = { note: "Simple keyword rules plus the form's role box, written after seeing the leads: a generous yardstick, not a fair contest.",
  answers: Object.fromEntries(leads.map((l) => [l.id, answers(l)])) };
fs.writeFileSync(new URL("./site/data/baseline-answers.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote site/data/baseline-answers.json (${leads.length} leads)`);

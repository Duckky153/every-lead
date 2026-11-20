// Every Lead: sorts one day of made-up leads into Go now, Check first and Fix first.
// One step uses a model: Jev's saved answers about what each person wrote. Everything that decides is plain code,
// in five named steps: arrived, checks, lane, message, handoff. The same data always gives the same result.
// Works in the browser (as a module) and in Node (for the tests).

// The lane rule in one line: a lead goes now unless a call can't work it yet (no way to reach them, or a duplicate),
// or a person must read it first (spam, orders to a computer, or Jev unsure what the business is). Questions a first
// call can settle (headcount, what the business does, who decides, a coverage question) travel with the lead as
// first-call steps when there is a working phone; without one, they go into a message.

const OWNER_WAITING = {
  "Ask the customer": "the customer",
  "Licensed person": "a licensed agent",
  "Teammate can fix": "a teammate (no customer needed)",
  "A person reads it": "a person",
};

// How owner names read on the page.
const OWNER_LABEL = {
  "Teammate can fix": "Teammate (no customer needed)",
  "Ask the customer": "Customer, by message",
  "Licensed person": "Licensed agent",
};
export function ownerLabel(o) {
  return OWNER_LABEL[o] || o;
}

const CODE_CHECKS = new Set(["phone_broken", "no_working_contact", "duplicate"]);
const FIRST_CALL = new Set(["headcount_mismatch", "industry_mismatch", "vague_business", "not_decision_maker", "coverage_question"]);
const CHECK_FIRST = new Set(["jev_error", "instructions_to_computer", "spam", "personal_not_business"]);

function isEmpty(v) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function addDays(iso, n) {
  const d = new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000);
  return d.toISOString().slice(0, 10);
}

export function shortDate(iso) {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

export function joinList(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values && values[k] !== null && values[k] !== undefined ? String(values[k]) : m));
}

// Edit distance, for "name one letter apart".
function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Business names compared without punctuation, accents or company suffixes ("Ortega Services LLC" = "Ortega Services").
export function normName(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/).filter((w) => w && !["llc", "inc", "co", "corp", "company", "the", "ltd"].includes(w)).join(" ");
}

export function sameBusinessName(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // One letter apart counts only for longer names that start the same ("Ridgline" / "Ridgeline", not "Joe's" / "Moe's").
  return x.length >= 8 && x[0] === y[0] && distance(x, y) === 1;
}

const digits = (v) => String(v || "").replace(/\D/g, "");

// ---------- Jev's answers ----------

// The reading key, written as if Jev had answered perfectly. Used for the "rules on the right answers" test.
export function perfectAnswers(readingKey) {
  const out = {};
  for (const [q, v] of Object.entries(readingKey)) {
    out[q] = v === "yes" || v === "no" ? { noul: v === "yes" ? 1 : 0 } : { choice: v, confidence: 1, probabilities: { [v]: 1 } };
  }
  return out;
}

// One saved reply, checked. Returns null when the reply fails the checks (the lead then goes to a person).
export function checkReply(config, raw) {
  if (!raw || typeof raw !== "object") return null;
  for (const [q, spec] of Object.entries(config.questions.questions)) {
    const a = raw[q];
    if (!a) return null;
    if (spec.type === "noul") {
      if (typeof a.noul !== "number" || a.noul < 0 || a.noul > 1) return null;
    } else {
      if (!(a.choice in spec.criteria) || typeof a.confidence !== "number" || a.confidence < 0 || a.confidence > 1) return null;
    }
  }
  return raw;
}

// Step "Jev read it": turns numbers into yes / no / unsure, then applies each question's rule for unsure.
// A yes/no number is Jev's chance of yes; a pick-one number is its confidence in the pick.
export function readAnswers(config, raw) {
  const r = config.rules;
  const qs = config.questions.questions;
  const checked = checkReply(config, raw);
  if (!checked) return { error: true, answers: {} };
  const answers = {};
  for (const [q, spec] of Object.entries(qs)) {
    const a = checked[q];
    if (spec.type === "noul") {
      const p = a.noul;
      const status = p >= r.yes_at_or_above ? "yes" : p <= r.no_at_or_below ? "no" : "unsure";
      let use = status;
      if (status === "unsure") use = spec.unsure === "treat_as_yes" || spec.unsure === "person" ? "yes" : "no";
      answers[q] = { kind: "yes_no", number: p, status, use, unsure: status === "unsure" };
    } else {
      const sure = a.confidence >= r.choice_counts_at;
      let use = a.choice;
      if (!sure) use = spec.unsure === "treat_as_not_stated" ? "not_stated" : spec.unsure === "no_flag" ? (q === "who_is_writing" ? "cannot_tell" : "not_stated") : "unsure";
      answers[q] = { kind: "pick", number: a.confidence, status: sure ? a.choice : "unsure", choice: a.choice, use, unsure: !sure };
    }
  }
  return { error: false, answers };
}

// ---------- step "checks" ----------

// A phone works if it has 10 digits (or 11 starting with 1) and no letters, in any common format.
export function phoneOk(config, v) {
  const s = String(v || "");
  const d = digits(s);
  return !/[A-Za-z]/.test(s) && (d.length === 10 || (d.length === 11 && d[0] === "1"));
}

function phoneKey(v) {
  return digits(v).slice(-10);
}

function emailOk(config, v) {
  return new RegExp(config.rules.email_pattern, "i").test(String(v || ""));
}

export function contactInText(config, text) {
  const ph = String(text || "").match(new RegExp(config.rules.contact_in_text.phone));
  if (ph && phoneOk(config, ph[0])) return { kind: "number", value: ph[0] };
  const em = String(text || "").match(new RegExp(config.rules.contact_in_text.email, "i"));
  if (em) return { kind: "email", value: em[0] };
  return null;
}

function findDuplicate(config, lead, earlier) {
  for (const o of earlier) {
    if (phoneOk(config, lead.phone) && phoneOk(config, o.phone) && phoneKey(lead.phone) === phoneKey(o.phone)) return { other: o, match: "the same phone number", field: "phone" };
    if (emailOk(config, lead.email) && lead.email.toLowerCase() === String(o.email || "").toLowerCase()) return { other: o, match: "the same email", field: "email" };
    if (lead.state === o.state && sameBusinessName(lead.business, o.business)) {
      return { other: o, match: normName(lead.business) === normName(o.business) ? "the same name in the same state" : "a name one letter apart, same state", field: "business" };
    }
  }
  return null;
}

const quoted = (v) => `"${v}"`;

function makeFlag(config, check, lead, values, extra = {}) {
  const w = config.wording.checks[check.id];
  const hit = new Set(extra.hit || check.evidence || []);
  return {
    check: check.id,
    name: check.name || w.row,
    row: w.row,
    found_by: check.found_by || "jev",
    owner: extra.owner || check.owner,
    wrong: extra.wrong || fill(w.wrong, values),
    fix: extra.fix || w.fix,
    first_call: w.first_call || null,
    rerun: w.rerun || null,
    ask: w.ask || null,
    person_question: w.person_question || null,
    evidence: (check.evidence || []).map((f) => ({ field: f, label: config.checks.fields[f] || f, value: isEmpty(lead[f]) ? "Missing" : String(lead[f]), hit: hit.has(f) })),
    unsure: Boolean(extra.unsure),
    held: Boolean(extra.held),
    ...extra.more,
  };
}

const num = (a) => (a ? a.number.toFixed(2) : "");
const validName = (s) => /[A-Za-z]{2,}/.test(String(s || ""));

// Every check on one lead. `fixes` holds what a visitor filled in (in their own browser only).
export function runChecks(config, lead, earlier, read, fixes = {}) {
  const r = config.rules;
  const count = Number(fixes.employees);
  const L = { ...lead, ...(fixes.phone ? { phone: fixes.phone } : {}), ...(fixes.email ? { email: fixes.email } : {}),
    ...(Number.isInteger(count) && count >= 1 && count <= 100000 ? { employees: count } : {}) };
  const A = read.answers;
  const flags = [];
  const passed = [];
  // A licensed agent's confirmed type, or the customer's own answer, replaces the picked type.
  const licensedConfirmed = validName(fixes.licensed_by) && fixes.confirmed_group;
  const formGroup = licensedConfirmed ? fixes.confirmed_group : fixes.business_described || r.industry_group[L.industry_picked];
  const isSpam = !read.error && A.spam_or_test.status === "yes";
  for (const check of config.checks.checks) {
    let flag = null;
    let ran = true;
    const a = check.question ? A[check.question] : null;
    if (check.question && read.error) continue;
    // Once the text reads as spam, the content checks are skipped: a person reads it first.
    if (isSpam && FIRST_CALL.has(check.id)) continue;
    switch (check.kind) {
      case "phone_bad_email_ok":
        if (!phoneOk(config, L.phone) && emailOk(config, L.email)) {
          flag = makeFlag(config, check, L, {}, { hit: ["phone"],
            wrong: isEmpty(L.phone) ? config.wording.checks.phone_broken.wrong_missing : fill(config.wording.checks.phone_broken.wrong, { phone_shown: L.phone }) });
        }
        break;
      case "no_contact":
        if (!phoneOk(config, L.phone) && !emailOk(config, L.email)) {
          const found = contactInText(config, L.what_they_wrote);
          const w = config.wording.checks.no_working_contact;
          const wrong = fill(w.wrong, { phone_shown: isEmpty(L.phone) ? "none" : quoted(L.phone), email_shown: isEmpty(L.email) ? "none" : quoted(L.email) });
          flag = found
            ? makeFlag(config, check, L, {}, { wrong, owner: check.owner_if_note_has_contact, hit: ["phone", "email"],
              fix: fill(w.fix_note, { contact_kind: found.kind, contact_found: found.value }), more: { contact_found: found } })
            : makeFlag(config, check, L, {}, { wrong, fix: w.fix_none, held: true, hit: ["phone", "email"] });
        }
        break;
      case "duplicate": {
        const d = fixes.merged ? null : findDuplicate(config, L, earlier);
        if (d) {
          flag = makeFlag(config, check, L, { other: d.other.id, other_business: d.other.business, other_time: d.other.came_in, match: d.match },
            { hit: [d.field], fix: fill(config.wording.checks.duplicate.fix, { other: d.other.id }), more: { duplicate_of: d.other.id } });
        }
        break;
      }
      case "bucket_differs": {
        const b = a.use;
        if (isEmpty(L.employees)) ran = false; // this form doesn't ask the headcount
        if (b in r.employee_buckets && !isEmpty(L.employees)) {
          const [lo, hi] = r.employee_buckets[b];
          if (L.employees < lo || L.employees > hi) {
            const names = { owner_only: "just the owner", "2_to_10": "2 to 10 people", "11_to_50": "11 to 50 people", over_50: "over 50 people" };
            flag = makeFlag(config, check, L, { employees: L.employees, bucket_name: names[b], answer_number: num(a) }, { hit: ["employees"] });
          }
        }
        break;
      }
      case "group_differs": {
        const g = a.use;
        const picked = r.industry_group[L.industry_picked];
        if (g in r.group_names && !["cannot_tell", "personal_not_business", "unsure"].includes(g) && g !== formGroup && !licensedConfirmed) {
          flag = makeFlag(config, check, L, { industry_picked: L.industry_picked, form_group: r.group_names[formGroup], read_group: r.group_names[g], answer_number: num(a) }, { hit: ["industry_picked"] });
        } else if (!licensedConfirmed && fixes.business_described && fixes.business_described !== picked) {
          // The customer's own answer disagrees with the type they picked: a licensed agent confirms it.
          flag = makeFlag(config, check, L, {}, { hit: ["industry_picked"],
            wrong: `They picked ${L.industry_picked}, which is ${r.group_names[picked]}, but say the business does ${r.group_names[fixes.business_described]}.` });
        }
        break;
      }
      case "answer_is":
        if (a.use === check.answer && !fixes.business_described) flag = makeFlag(config, check, L, { answer_number: num(a) });
        break;
      case "answer_in":
        if (check.answers.includes(a.use) && !validName(fixes.decision_maker)) {
          flag = makeFlag(config, check, L, { who_name: a.use === "someone_outside" ? "someone outside the business" : "a staff member writing for someone else", answer_number: num(a) });
        }
        break;
      case "yes_or_unsure":
        if (a.use === "yes" && !(check.id === "coverage_question" && validName(fixes.coverage_replied_by))) {
          flag = makeFlag(config, check, L, { yes_word: a.unsure ? "unsure" : "yes", answer_number: num(a) }, { unsure: a.unsure,
            wrong: a.unsure ? fill(config.wording.checks[check.id].wrong_unsure, { answer_number: num(a) }) : null });
        }
        break;
      case "yes":
        if (a.status === "yes") flag = makeFlag(config, check, L, { answer_number: num(a) });
        break;
      default:
        throw new Error(`Unknown check kind: ${check.kind}`);
    }
    if (flag) flags.push(flag);
    else if (ran) passed.push(check.name);
  }
  // With no working phone or email at all, "phone works" did not really pass.
  if (flags.some((f) => f.check === "no_working_contact")) {
    const i = passed.indexOf(config.checks.checks.find((c) => c.id === "phone_broken").name);
    if (i >= 0) passed.splice(i, 1);
  }
  // Person-only reasons.
  const po = Object.fromEntries(config.checks.person_only.map((c) => [c.id, c]));
  if (read.error) flags.push(makeFlag(config, { ...po.jev_error, found_by: "jev" }, L, {}, { unsure: true }));
  else if (isSpam) { /* a person reads it; no content reasons */ }
  else if (A.what_business.use === "personal_not_business") flags.push(makeFlag(config, { ...po.personal_not_business, found_by: "jev" }, L, { answer_number: num(A.what_business) }));
  else if (A.what_business.use === "unsure" && !fixes.business_described && !licensedConfirmed) flags.push(makeFlag(config, { ...po.business_unsure, found_by: "jev" }, L, { answer_number: num(A.what_business) }, { unsure: true }));
  return { lead: L, flags, passed };
}

// ---------- step "lane" ----------

export function pickLane(config, flags, lead) {
  if (flags.some((f) => CHECK_FIRST.has(f.check))) return "check_first";
  if (flags.some((f) => CODE_CHECKS.has(f.check))) return "fix_first";
  // Questions a call can settle go with the lead when there's a working phone; otherwise they go in a message.
  if (flags.some((f) => FIRST_CALL.has(f.check)) && !phoneOk(config, lead && lead.phone)) return "fix_first";
  if (flags.some((f) => f.check === "business_unsure")) return "check_first";
  return "go_now";
}

function pickOwner(config, lane, flags) {
  if (lane === "go_now") return config.wording.lanes.go_now.owner;
  if (lane === "check_first") return "A person reads it";
  const owners = new Set(flags.map((f) => f.owner));
  return config.rules.owner_priority.find((o) => owners.has(o)) || flags[0].owner;
}

// ---------- step "message" ----------

function buildMessage(config, lead, flags) {
  const asks = flags.filter((f) => (f.owner === "Ask the customer" || FIRST_CALL.has(f.check)) && f.ask && !f.held).map((f) => f.ask);
  if (!asks.length) return null;
  const w = config.wording.message;
  const first = String(lead.contact || "").split(" ")[0] || "there";
  const byText = lead.sms_consent === true && phoneOk(config, lead.phone);
  const channel = byText ? "text message" : emailOk(config, lead.email) ? "email" : null;
  if (!channel) return null;
  const body = [
    fill(w.greeting, { first_name: first, business: lead.business }),
    asks.length === 1 ? fill(w.ask_one, { item: asks[0] }) : fill(w.ask_many, { items: joinList(asks) }),
    flags.some((f) => f.check === "not_decision_maker") ? w.close_decider : w.close,
    w.sign,
  ].join(" ");
  return { channel, to: channel === "email" ? lead.email : lead.phone, items: asks, text: body };
}

// ---------- Go now order and next steps ----------

function urgency(config, lead, read) {
  const r = config.rules;
  if (lead.needed_by && daysBetween(r.day, lead.needed_by) <= r.right_away_days) return { urgent: true, why: "date" };
  if (!read.error && read.answers.timing.use === "right_away") return { urgent: true, why: "text" };
  return { urgent: false };
}

function nextSteps(config, lead, read, u, flags) {
  const n = config.wording.next_steps;
  const steps = [n.confirm];
  if (u.urgent) steps.push(u.why === "date" ? fill(n.urgent_date, { date: shortDate(lead.needed_by) }) : n.urgent_text);
  for (const f of flags) if (FIRST_CALL.has(f.check) && f.first_call) steps.push(f.first_call + (f.unsure ? " (Jev was unsure)" : ""));
  if (lead.partner) steps.push(fill(n.partner, { partner: lead.partner }));
  if ((lead.coverage_wanted || []).includes("Workers' comp")) steps.push(n.payroll);
  if ((lead.coverage_wanted || []).includes("Commercial auto")) steps.push(n.vehicles);
  if (lead.renews) {
    const follow = addDays(lead.renews, -config.rules.renewal_follow_up_days);
    steps.push(fill(n.renewal_date, { date: shortDate(follow < config.rules.day ? config.rules.day : follow) }));
  } else if (!read.error && read.answers.timing.use === "has_policy_renewing_later") steps.push(n.renewal_ask);
  steps.push(n.options);
  return steps;
}

// ---------- step "handoff" and the Steps list ----------

function buildCard(config, lane, owner, flags, passed, message) {
  if (lane === "go_now") return null;
  const held = flags.some((f) => f.held);
  const waiting = held ? "the customer to write again" : OWNER_WAITING[owner] || "a person";
  const personQ = flags.find((f) => f.person_question && lane === "check_first");
  const lines = [...new Set(flags.map((f) => f.rerun).filter(Boolean))].join(" ");
  return {
    waiting_for: waiting,
    wrong: flags.map((f) => f.wrong),
    fixes: [...new Set(flags.map((f) => (lane === "fix_first" && FIRST_CALL.has(f.check) && f.ask ? `Ask ${f.ask.replace(/\byou\b/g, "them").replace(/\byour\b/g, "their")} in the message.` : f.fix)))],
    done: passed,
    when_back: lane === "check_first"
      ? (personQ ? personQ.person_question : "A person reads the note and decides the next step.")
      : (/closes only/.test(lines) ? lines : `${lines} The flag closes only if the check passes.`).trim(),
    also_person: lane === "fix_first" && flags.some((f) => f.unsure),
    message,
    held,
  };
}

function stepsList(config, lead, read, meta, lane, owner, flags, message, card, rank, closed, firstCall) {
  const SRC = { web_form: "web form", phone_call: "phone call", website_chat: "website chat", partner_email: "partner email" };
  const out = [{ text: `Arrived ${lead.came_in} (made-up clock), ${SRC[lead.source] || lead.source}`, label: "CODE" }];
  const when = meta && meta.read_on ? `read ${meta.read_on}${meta.tokens ? `, ${meta.tokens} tokens` : ""}` : "saved answers";
  if (read.error) out.push({ text: `Jev did not read it (${when})`, label: "MODEL" });
  else {
    const unsure = Object.entries(read.answers).filter(([, a]) => a.unsure).map(([q]) => q.replaceAll("_", " "));
    out.push({ text: `Jev read it: 7 answers, ${unsure.length ? `unsure on ${joinList(unsure)}` : "none unsure"} (${when})`, label: "MODEL" });
  }
  out.push({ text: flags.length ? `Checks: ${joinList(flags.map((f) => f.row.toLowerCase()))}` : "Checks: all passed", label: "CODE" });
  const laneName = (config.wording.lanes[lane] || {}).name;
  if (lane === "go_now") {
    out.push({ text: `Go now, number ${rank}. Owner: ${ownerLabel(owner)}`, label: "CODE" });
    out.push({ text: firstCall.length ? `First-call steps written, with ${firstCall.length === 1 ? "one question" : `${firstCall.length} questions`} the call can settle` : "First-call steps written", label: "CODE" });
    out.push({ text: "Next: the first call (licensed agent)", label: "NEXT" });
  } else if (lane === "merged") {
    out.push({ text: `Merged into ${card.merged_into}, so the business gets one call`, label: "CODE" });
    out.push({ text: "Next: nothing here; the first lead carries both notes", label: "NEXT" });
  } else {
    out.push({ text: `${laneName}. Owner: ${ownerLabel(owner)}`, label: "CODE" });
    if (message) out.push({ text: `Message ready: ${message.channel} asking for ${joinList(message.items)}. Not sent.`, label: "CODE" });
    out.push({ text: "Handoff card written", label: "CODE" });
    if (closed) out.push({ text: `Closed by ${closed.by}, ${closed.date}: "${closed.reason}"`, label: "PERSON" });
    else out.push({ text: `Next: waiting for ${card.waiting_for}`, label: "NEXT" });
  }
  return out;
}

// ---------- the whole day ----------

// answersById: Jev's saved replies (or perfectAnswers of the key); meta: per-lead run details from jev-answers.json.
export function runDay(config, leads, answersById, { meta = {}, fixes = {}, closed = {} } = {}) {
  const results = [];
  const earlier = [];
  for (const lead of leads) {
    const read = readAnswers(config, answersById[lead.id]);
    const f = fixes[lead.id] || {};
    const { lead: L, flags, passed } = runChecks(config, lead, earlier, read, f);
    // A duplicate a visitor merged leaves the lanes: it is one lead now, carried by the earlier one.
    const mergedInto = f.merged ? (findDuplicate(config, L, earlier) || {}).other : null;
    earlier.push(L);
    const lane = mergedInto ? "merged" : pickLane(config, flags, L);
    const owner = lane === "merged" ? "Merged" : pickOwner(config, lane, flags);
    const u = urgency(config, L, read);
    const message = lane === "fix_first" ? buildMessage(config, L, flags) : null;
    const card = lane === "merged" ? { merged_into: mergedInto.id, waiting_for: "nobody" } : buildCard(config, lane, owner, flags, passed, message);
    const firstCall = lane === "go_now" ? flags.filter((x) => FIRST_CALL.has(x.check)) : [];
    results.push({ id: lead.id, lead: L, read, flags, passed, lane, owner, urgent: u.urgent, urgent_why: u.why || null, first_call: firstCall,
      next_steps: lane === "go_now" ? nextSteps(config, L, read, u, flags) : [], message, card, closed: closed[lead.id] || null });
  }
  // A merged duplicate hands its urgency and its note to the lead it was merged into.
  for (const m of results.filter((x) => x.lane === "merged")) {
    const into = results.find((x) => x.id === m.card.merged_into);
    if (into && m.urgent && !into.urgent) {
      into.urgent = true;
      into.urgent_why = m.urgent_why;
      into.urgent_due = m.urgent_why === "date" ? m.lead.needed_by : config.rules.day;
    }
    if (into && into.lane === "go_now") into.next_steps.splice(1, 0, fill(config.wording.next_steps.merged, { other: m.id }));
  }
  // Go now order: urgent first (soonest need first; "right away" in their note counts as today), then longest wait.
  const due = (r) => (!r.urgent ? "9999" : r.urgent_due || (r.urgent_why === "date" && r.lead.needed_by) || config.rules.day);
  const go = results.filter((r) => r.lane === "go_now").sort((a, b) => (b.urgent - a.urgent) || due(a).localeCompare(due(b)) || a.lead.came_in.localeCompare(b.lead.came_in));
  go.forEach((r, i) => { r.rank = i + 1; });
  for (const r of results) r.steps = stepsList(config, r.lead, r.read, meta[r.id], r.lane, r.owner, r.flags, r.message, r.card, r.rank, r.closed, r.first_call);
  const count = (lane) => results.filter((r) => r.lane === lane).length;
  const inLanes = count("go_now") + count("check_first") + count("fix_first") + count("merged");
  return {
    results,
    go_now_order: go.map((r) => r.id),
    summary: {
      total: results.length,
      go_now: count("go_now"),
      go_now_with_questions: results.filter((r) => r.lane === "go_now" && r.first_call.length).length,
      check_first: count("check_first"),
      fix_first: count("fix_first"),
      merged: count("merged"),
      held: results.filter((r) => r.card && r.card.held).length,
      dropped_by_tool: results.length - inLanes,
      closed_by_person: results.filter((r) => r.closed).length,
    },
  };
}

// ---------- evals ----------

const JEV_KINDS = new Set(["headcount_mismatch", "industry_mismatch", "vague_business", "not_decision_maker", "coverage_question", "spam", "instructions_to_computer"]);
const KIND_QUESTION = { headcount_mismatch: "employees_in_text", industry_mismatch: "what_business", vague_business: "what_business",
  not_decision_maker: "who_is_writing", coverage_question: "asks_coverage_question", spam: "spam_or_test", instructions_to_computer: "instructions_in_text" };

function kindToCheck(kind) {
  return kind.startsWith("no_working_contact") ? "no_working_contact" : kind;
}

// Scores a day against the answer keys. Code-found problems are a test (built to catch exactly these);
// Jev-read problems are the real score. A problem counts as caught when its check fired on that lead with the
// planted owner (the same definition as when Jev read the leads).
// `expected`, if given, is the same day run on the answer key, for the lead-level comparison.
export function score(config, day, problemKey, readingKey, expected = null) {
  const byId = Object.fromEntries(day.results.map((r) => [r.id, r]));
  const missed = [];
  let codeCaught = 0, codeTotal = 0, jevCaught = 0, jevTotal = 0;
  const wanted = new Set();
  for (const [id, probs] of Object.entries(problemKey)) {
    const r = byId[id];
    if (!r) continue;
    for (const p of probs) {
      const check = kindToCheck(p.kind);
      wanted.add(`${id}:${check}`);
      const hit = r.flags.find((f) => f.check === check && f.owner === p.owner);
      const isJev = JEV_KINDS.has(p.kind);
      if (isJev) jevTotal++; else codeTotal++;
      if (hit) { if (isJev) jevCaught++; else codeCaught++; }
      else {
        const q = KIND_QUESTION[p.kind];
        const a = q && !r.read.error ? r.read.answers[q] : null;
        missed.push({ id, kind: p.kind, found_by: isJev ? "jev" : "code", lane: r.lane,
          jev_answer: a ? { question: q, answer: a.unsure ? "unsure" : a.status, leaning: a.choice || null, number: a.number } : null });
      }
    }
  }
  const falseAlarms = [];
  const unsureExtra = [];
  for (const r of day.results) {
    for (const f of r.flags) {
      if (wanted.has(`${r.id}:${f.check}`)) continue;
      if (f.unsure) unsureExtra.push({ id: r.id, check: f.check, lane: r.lane });
      else falseAlarms.push({ id: r.id, check: f.check, found_by: f.found_by, lane: r.lane });
    }
  }
  const cleanIds = Object.entries(problemKey).filter(([id, p]) => p.length === 0 && byId[id]).map(([id]) => id);
  const slowed = [];
  const falseAlarmLeads = new Set(falseAlarms.map((f) => f.id));
  for (const id of cleanIds) {
    const r = byId[id];
    if (r.lane === "go_now") continue;
    if (!falseAlarmLeads.has(id)) slowed.push({ id, lane: r.lane, because: r.flags.map((f) => f.check) });
  }
  // Question by question.
  const reading = {};
  for (const q of Object.keys(config.questions.questions)) reading[q] = { right: 0, confident_wrong: 0, unsure: 0, wrong_ids: [] };
  for (const r of day.results) {
    const key = readingKey[r.id];
    if (!key) continue;
    for (const q of Object.keys(config.questions.questions)) {
      const a = r.read.answers[q];
      if (!a || r.read.error) { reading[q].unsure++; continue; }
      if (a.unsure) reading[q].unsure++;
      else if (a.status === key[q]) reading[q].right++;
      else { reading[q].confident_wrong++; reading[q].wrong_ids.push(r.id); }
    }
  }
  const totals = Object.values(reading).reduce((t, v) => ({ right: t.right + v.right, confident_wrong: t.confident_wrong + v.confident_wrong, unsure: t.unsure + v.unsure }), { right: 0, confident_wrong: 0, unsure: 0 });
  // Lead level: does each lead land in the same lane, with the same owner, as it would with the answer key?
  let leadLevel = null;
  if (expected) {
    const exp = Object.fromEntries(expected.results.map((r) => [r.id, r]));
    const differ = day.results.filter((r) => exp[r.id] && (exp[r.id].lane !== r.lane || exp[r.id].owner !== r.owner))
      .map((r) => ({ id: r.id, got: r.lane, want: exp[r.id].lane }));
    leadLevel = { same: day.results.length - differ.length, total: day.results.length, differ };
  }
  return {
    code: { caught: codeCaught, total: codeTotal },
    jev: { caught: jevCaught, total: jevTotal },
    missed,
    missed_in_go_now: missed.filter((m) => m.lane === "go_now").length,
    false_alarms: falseAlarms,
    false_alarms_code: falseAlarms.filter((f) => f.found_by === "code").length,
    false_alarms_jev: falseAlarms.filter((f) => f.found_by !== "code").length,
    unsure_extra: unsureExtra,
    slowed,
    unsure_planted: unsureExtra.filter((x) => (problemKey[x.id] || []).length > 0),
    lead_level: leadLevel,
    reading,
    reading_totals: { ...totals, answers: day.results.length * Object.keys(config.questions.questions).length },
    clean_leads: cleanIds.length,
  };
}

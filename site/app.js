// Every Lead page. Loads the made-up day and Jev's saved answers, runs the engine in the browser, draws the page.
// The page never calls Jev. A visitor's clicks (Fill in the fix, Hold, Merge) stay in their own browser and are labeled.
import { runDay, perfectAnswers, score, joinList, ownerLabel } from "./engine.js";

const $ = (s) => document.querySelector(s);
const LANES = ["go_now", "check_first", "fix_first"];
const SRC = { web_form: "Web form", phone_call: "Phone call", website_chat: "Website chat", partner_email: "Partner email" };
const UPSTREAM = {
  phone_broken: "have the form check for a full 10-digit number",
  no_working_contact: "require one working phone or email before the form sends",
  duplicate: "warn when the same phone or email came in earlier the same day",
  headcount_mismatch: "ask the headcount in the same words on every channel",
  industry_mismatch: "show a short description under each business type",
  vague_business: "ask \"What does your business do day to day?\" as its own box",
  not_decision_maker: "ask \"Are you the owner or the person who decides?\"",
  coverage_question: "send questions to a licensed agent straight away",
  spam: "add a simple spam check to the form",
  instructions_to_computer: "keep showing notes as plain text, never as instructions",
};
const QNAME = { what_business: "What the business does", who_is_writing: "Who wrote it", asks_coverage_question: "Asks a coverage question",
  timing: "When they need it", employees_in_text: "People, from the note", spam_or_test: "Spam or a test", instructions_in_text: "Orders to a computer" };
const USED_BY = { headcount_mismatch: "employees_in_text", industry_mismatch: "what_business", vague_business: "what_business", not_decision_maker: "who_is_writing",
  coverage_question: "asks_coverage_question", spam: "spam_or_test", instructions_to_computer: "instructions_in_text", business_unsure: "what_business", personal_not_business: "what_business" };
const FIRST_CALL_CHECKS = new Set(["headcount_mismatch", "industry_mismatch", "vague_business", "not_decision_maker", "coverage_question"]);
const UNSURE_WORD = { person: "a person reads it", treat_as_yes: "counted as yes", treat_as_no: "counted as no", no_flag: "no flag", treat_as_not_stated: "counted as not stated" };

const state = { tab: "go_now", showAll: false, fixes: {}, clicks: {}, holds: {}, open: null, opener: null, banner: null };
let D = null;

async function getJSON(name, optional = false) {
  const r = await fetch(`data/${name}`);
  if (!r.ok) { if (optional) return null; throw new Error(`${name}: ${r.status}`); }
  return r.json();
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

function emph(text) {
  // "[60] go now" style lines: numbers in bold.
  const p = document.createDocumentFragment();
  text.split(/(\[[^\]]+\])/).forEach((part) => p.append(part.startsWith("[") ? el("b", { text: part.slice(1, -1) }) : part));
  return p;
}

function compute() {
  const { config, leads, answers, meta, closed } = D;
  D.day = runDay(config, leads, answers, { meta, fixes: state.fixes, closed });
  if (!D.baseDay) D.baseDay = runDay(config, leads, answers, { meta, closed });
}

function laneCounts(day) {
  return Object.fromEntries([...LANES, "merged"].map((l) => [l, day.results.filter((r) => r.lane === l).length]));
}

// ---------- hero ----------

function drawHero() {
  // The hero shows the day as it came in; the leads list below follows a visitor's clicks.
  const s = D.baseDay.summary;
  $("#h-lead").replaceChildren(emph(`100 made-up leads came in today. [${s.go_now}] go now, [${s.go_now_with_questions}] of them with a question for the first call. [${s.fix_first}] get fixed first and [${s.check_first}] wait for a person. None are dropped.`));
  const lines = D.config.wording.lanes;
  $("#h-strip").replaceChildren(...LANES.map((l) => el("div", { class: `cell${state.tab === l ? " on" : ""}` },
    el("button", { type: "button", onclick: () => { state.tab = l; state.showAll = false; drawAll(); const t = document.querySelector("#l-tabs button.on"); if (t) { t.focus(); t.scrollIntoView({ behavior: "smooth", block: "center" }); } } },
      el("span", { class: "n" }, `${lines[l].name}: `, el("em", { text: String(s[l]) })),
      el("span", { class: "d", text: lines[l].line })))));
}

// ---------- the leads list ----------

function oneLine(r) {
  if (r.lane === "go_now") {
    const urgent = r.urgent ? (r.urgent_why === "date" ? `Needed by ${r.next_steps.find((s) => s.startsWith("Needed by")).replace("Needed by ", "").replace(" (from the form)", "")}` : "Needs it right away") : "";
    const ask = r.first_call.map((f) => D.config.wording.checks[f.check].list_line).filter(Boolean);
    return [urgent, ask.length ? `On the call: ${ask.join("; ").replace(/^./, (x) => x.toLowerCase())}` : ""].filter(Boolean).join(" · ") || "Ready for a first call";
  }
  if (r.lane === "merged") return `Merged into ${r.card.merged_into}`;
  return r.flags.map((f) => f.row).join("; ");
}

function nextWord(r) {
  if (r.closed) return "Closed by a person";
  if (r.lane === "merged") return "Merged (your click)";
  if (state.holds[r.id]) return "On hold (your click)";
  if (r.lane === "go_now") return r.urgent ? "Call first" : "Call";
  if (r.lane === "check_first") return "Read it";
  if (r.card && r.card.held) return "On hold";
  if (r.flags.some((f) => f.check === "duplicate")) return "Merge";
  if (r.message) return "Message ready";
  return "Fix it";
}

function drawLeads() {
  const day = D.day;
  const counts = laneCounts(day);
  const base = laneCounts(D.baseDay);
  const names = D.config.wording.lanes;
  const delta = (l) => (counts[l] === base[l] ? "" : ` (${counts[l] > base[l] ? "+" : ""}${counts[l] - base[l]} from your clicks)`);
  $("#l-title").textContent = `${names[state.tab].name}: ${counts[state.tab]} leads${delta(state.tab)}`;
  $("#l-tabs").replaceChildren(...LANES.map((l) => el("button", { type: "button", role: "tab", "aria-selected": String(state.tab === l), class: state.tab === l ? "on" : "",
    onclick: () => { state.tab = l; state.showAll = false; drawAll(); } }, `${names[l].name} ${counts[l]}`)));
  let rows = day.results.filter((r) => r.lane === state.tab);
  if (state.tab === "go_now") rows.sort((a, b) => a.rank - b.rank);
  const limit = state.showAll ? rows.length : 15;
  const head = el("div", { class: "row lead-row head" }, el("span", { text: "Came in" }), el("span", { text: "Business (sample)" }), el("span", { text: "In one line" }), el("span", { text: "Next" }));
  const list = rows.slice(0, limit).map((r) => el("div", { class: "row lead-row", tabindex: "0", role: "button", "data-id": r.id, "aria-label": `${r.lead.business}: ${oneLine(r)}`,
    onclick: () => openPanel(r.id), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(r.id); } } },
    el("span", { class: "date", text: r.lead.came_in }),
    el("span", { class: "bizcell" }, r.lead.business, el("span", { class: "biz", text: `${SRC[r.lead.source]} · ${r.lead.state}` })),
    el("span", { class: "what one", text: oneLine(r) }),
    el("span", { class: "status", text: nextWord(r) })));
  const more = rows.length > limit ? el("div", { class: "more" }, el("button", { type: "button", class: "btn ghost", onclick: () => { state.showAll = true; drawLeads(); } }, `Show all ${rows.length}`)) : null;
  $("#l-rows").replaceChildren(head, ...list, ...(more ? [more] : []));
  const clicked = Object.keys(state.fixes).length + Object.keys(state.holds).length > 0;
  $("#l-caption").textContent = clicked
    ? "Click a lead to see what's wrong, the fix and its steps. These counts include your clicks; the numbers at the top are the day as it came in."
    : "Click a lead to see what's wrong, the fix and its steps.";
}

// ---------- the lead panel ----------

function answerText(q, a) {
  const g = D.config.rules.group_names;
  if (a.kind === "yes_no") return `${a.status === "unsure" ? "unsure" : a.status} (chance of yes ${a.number.toFixed(2)})`;
  const label = (v) => (q === "what_business" ? g[v] || v : String(v).replaceAll("_", " "));
  return a.status === "unsure" ? `unsure, leaning ${label(a.choice)} (confidence ${a.number.toFixed(2)})` : `${label(a.status)} (confidence ${a.number.toFixed(2)})`;
}

function openPanel(id) {
  if (!state.open && document.activeElement && document.activeElement !== document.body) state.opener = document.activeElement;
  state.open = id;
  const r = D.day.results.find((x) => x.id === id);
  const L = r.lead;
  const names = D.config.wording.lanes;
  const laneName = r.lane === "merged" ? "Merged" : names[r.lane].name;
  const body = [];
  body.push(el("div", { class: "panel-top" },
    el("div", {}, el("h3", { text: L.business }), el("p", { class: "sub", text: `${L.id} · came in ${L.came_in} · ${SRC[L.source]} · ${laneName}${r.lane === "merged" ? "" : ` · ${ownerLabel(r.owner)}`}` })),
    el("button", { type: "button", class: "close", onclick: closePanel }, "Close")));

  // The result of a visitor's last fix, at the top where they can see it.
  if (state.banner && state.banner.id === id) {
    body.push(el("div", { class: `result ${state.banner.ok ? "ok" : "bad"}`, role: "status", tabindex: "-1", id: "fix-banner" },
      el("b", { text: state.banner.title }), el("span", { text: ` ${state.banner.text}` })));
  }

  if (r.lane === "merged") {
    body.push(el("div", { class: "card person" }, el("p", { class: "waiting", text: `Merged into ${r.card.merged_into} (your click).` }),
      el("p", { class: "done-note", text: `${r.card.merged_into} now carries both notes, so the business gets one call. Nothing is left to do here.` })));
  } else if (r.lane === "go_now") {
    body.push(el("div", { class: "sec first" }, el("span", { class: "l", text: `Go now, number ${r.rank}: on the first call` }),
      el("ol", { class: "qlist" }, ...r.next_steps.slice(0, 3).map((s) => el("li", { text: s }))),
      r.next_steps.length > 3 ? el("details", { class: "more-info" }, el("summary", { text: "More for the call" }), el("ul", { class: "qlist" }, ...r.next_steps.slice(3).map((s) => el("li", { text: s })))) : null,
      r.first_call.length ? el("p", { class: "done-note", text: `Why: ${r.first_call.map((f) => f.wrong).join(" ")}` }) : null));
  } else {
    body.push(drawCard(r));
  }

  body.push(el("div", { class: "sec" }, el("span", { class: "l", text: "What they wrote" }), el("p", { class: "wrote", text: L.what_they_wrote })));
  for (const m of D.day.results.filter((x) => x.lane === "merged" && x.card.merged_into === id)) {
    body.push(el("div", { class: "sec" }, el("span", { class: "l", text: `Merged in from ${m.id} (your click), came in ${m.lead.came_in}` }), el("p", { class: "wrote", text: m.lead.what_they_wrote })));
  }

  const used = new Set(r.flags.map((f) => USED_BY[f.check]).filter(Boolean));
  const reads = r.read.error ? [el("li", {}, el("span", { class: "q", text: "Jev did not read this lead." }))]
    : Object.entries(r.read.answers).map(([q, a]) => el("li", { class: used.has(q) ? "used" : "" },
      el("span", { class: "q", text: QNAME[q] }),
      el("span", { class: "a" }, answerText(q, a), a.unsure ? el("span", { class: "u", text: ` · ${UNSURE_WORD[D.config.questions.questions[q].unsure]}` }) : null)));
  body.push(el("div", { class: "sec" }, el("span", { class: "l", text: "What Jev read" }), el("ul", { class: "reads" }, ...reads)));

  if (r.lane !== "merged") {
    const ev = new Map();
    for (const f of r.flags) for (const e of f.evidence) if (e.field !== "what_they_wrote" && (e.hit || !ev.has(e.field))) ev.set(e.field, e);
    body.push(el("div", { class: "sec" }, el("span", { class: "l", text: "Checks" }),
      ev.size ? el("dl", { class: "evidence" }, ...[...ev.values()].flatMap((e) => [el("dt", { text: e.label }), el("dd", { class: e.hit ? "hit" : "", text: e.value })])) : null,
      el("p", { class: "done-note", text: r.passed.length ? `Passed: ${joinList(r.passed.map((p) => p.toLowerCase()))}.` : "No other checks passed." })));
  }

  // After a click: the day as it came in, up to its checks; then the clicks; then what the re-run decided.
  const clicks = state.clicks[id] || [];
  let steps = r.steps;
  if (clicks.length) {
    const before = D.baseDay.results.find((x) => x.id === id).steps;
    const upTo = before.findIndex((s) => s.text.startsWith("Checks:")) + 1;
    steps = before.slice(0, upTo).concat(clicks, r.steps.slice(r.steps.findIndex((s) => s.text.startsWith("Checks:")) + 1));
  }
  body.push(el("div", { class: "sec" }, el("span", { class: "l", text: "Steps" }),
    el("ul", { class: "steps" }, ...steps.map((s) => el("li", { class: s.label === "NEXT" ? "next" : "" }, el("span", { text: s.text }), el("span", { class: `lab ${s.label.replace(" ", "_")}`, text: s.label })))),
    el("p", { class: "caption", text: `The code steps ran in your browser just now. Jev's step shows the saved answer${D.runDate ? ` from ${D.runDate}` : ""}; the page never calls Jev.` })));

  $("#panel-body").replaceChildren(...body.filter(Boolean));
  $("#panel").hidden = false; $("#scrim").hidden = false;
  $("#panel").scrollTop = 0;
  ($("#fix-banner") || $("#panel")).focus();
}

function drawCard(r) {
  const c = r.card;
  const isPerson = r.lane === "check_first";
  const held = state.holds[r.id];
  const parts = [el("p", { class: "waiting", text: held ? `On hold (your click): ${held}` : `Waiting for: ${c.waiting_for}.` }),
    el("dl", {},
      el("dt", { text: "What's wrong" }), el("dd", {}, ...c.wrong.map((t) => el("p", { text: t }))),
      el("dt", { text: isPerson ? "A person answers" : "The fix" }), el("dd", {}, ...(isPerson ? [el("p", { text: c.when_back })] : c.fixes.map((t) => el("p", { text: t })))))];
  if (c.also_person) parts.push(el("p", { class: "done-note", text: "Jev was unsure on one answer, so a person also reads this." }));
  if (!isPerson) parts.push(drawFixForm(r));
  if (c.message) {
    const m = c.message;
    const status = el("span", { class: "state", text: "Nothing is sent." });
    parts.push(el("div", { class: "msg" }, el("span", { class: "l", text: `Message (${m.channel} to ${m.to})` }), el("p", { text: m.text }),
      el("div", { class: "row-btns" }, el("button", { type: "button", class: "btn", onclick: () => copy(m.text, status) }, "Copy"), status)));
  }
  if (r.closed) parts.push(el("p", { class: "done-note", text: `Closed by ${r.closed.by}, ${r.closed.date}: "${r.closed.reason}"` }));
  return el("div", { class: `card${isPerson ? " person" : ""}` }, ...parts);
}

function copy(text, status) {
  const done = () => { status.textContent = "Copied. Nothing is sent."; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => { status.textContent = "Select the text above to copy it."; });
  else status.textContent = "Select the text above to copy it.";
}

const GROUP_OPTIONS = () => Object.entries(D.config.rules.group_names).filter(([k]) => !["cannot_tell", "personal_not_business"].includes(k));
const FIELD_WORDS = { phone: "the phone", employees: "the headcount", business_described: "what the business does", decision_maker: "who decides",
  licensed_by: "the licensed agent", confirmed_group: "the confirmed type", coverage_replied_by: "the licensed agent" };

function drawFixForm(r) {
  const wrap = el("div", { class: "fixwrap" });
  const form = el("form", { class: "fixform", novalidate: "" });
  const inputs = [];
  const add = (label, node) => { inputs.push(node); form.append(el("label", {}, label, node)); return node; };
  const select = (name) => el("select", { name }, el("option", { value: "", text: "Pick one" }), ...GROUP_OPTIONS().map(([k, v]) => el("option", { value: k, text: v })));
  const checks = new Set(r.flags.map((f) => f.check));
  const quick = [];
  if (checks.has("phone_broken")) add("Phone they sent", el("input", { name: "phone", placeholder: "(512) 555-0123", inputmode: "tel", autocomplete: "off" }));
  const nwc = r.flags.find((f) => f.check === "no_working_contact");
  if (nwc && nwc.contact_found) quick.push(el("button", { type: "button", class: "btn primary", onclick: () => applyFix(r, nwc.contact_found.kind === "email" ? { email: nwc.contact_found.value } : { phone: nwc.contact_found.value }, `You used the ${nwc.contact_found.kind} from the note`) }, `Use the ${nwc.contact_found.kind} in the note`));
  const dup = r.flags.find((f) => f.check === "duplicate");
  if (dup) quick.push(el("button", { type: "button", class: "btn primary", onclick: () => applyFix(r, { merged: true }, `You merged it into ${dup.duplicate_of}`) }, `Merge into ${dup.duplicate_of}`));
  if (checks.has("headcount_mismatch")) add("People who work there, owner included", el("input", { name: "employees", inputmode: "numeric" }));
  if (checks.has("vague_business")) add("What the business does", select("business_described"));
  if (checks.has("not_decision_maker")) add("Who decides, and how to reach them", el("input", { name: "decision_maker" }));
  if (checks.has("industry_mismatch")) { add("Licensed agent who confirmed it", el("input", { name: "licensed_by" })); add("Confirmed business type", select("confirmed_group")); }
  if (checks.has("coverage_question")) add("Licensed agent who answered", el("input", { name: "coverage_replied_by" }));
  const result = el("p", { class: "fix-result", role: "status" });
  if (inputs.length) {
    form.append(el("div", { class: "actions" }, el("button", { type: "submit", class: "btn primary" }, "Fill in the fix"), ...quick));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = {};
      for (const [k, v] of new FormData(form).entries()) if (String(v).trim()) f[k] = String(v).trim();
      if (checks.has("industry_mismatch") && (f.licensed_by || f.confirmed_group) && !(f.licensed_by && f.confirmed_group)) {
        result.textContent = f.licensed_by ? "Pick the confirmed business type too." : "Add the licensed agent's name too.";
        result.className = "fix-result bad"; return;
      }
      if (!Object.keys(f).length) { result.textContent = "Fill in a box first."; result.className = "fix-result bad"; return; }
      applyFix(r, f, `You filled in ${joinList(Object.keys(f).map((k) => FIELD_WORDS[k] || k))}`);
    });
  } else if (quick.length) {
    form.append(el("div", { class: "actions" }, ...quick));
  }
  if (r.card && r.card.when_back && !r.card.held) form.append(el("p", { class: "done-note", text: r.card.when_back }));
  form.append(result);
  wrap.append(form, holdRow(r), el("p", { class: "done-note", text: "Your clicks stay in your browser only." }));
  return wrap;
}

function holdRow(r) {
  const row = el("div", { class: "reason" });
  const start = el("button", { type: "button", class: "btn ghost", onclick: () => {
    const input = el("input", { "aria-label": "Reason for the hold", placeholder: "Reason for the hold" });
    const save = () => {
      const why = input.value.trim();
      if (!why) return;
      state.holds[r.id] = why;
      (state.clicks[r.id] ||= []).push({ text: `You put it on hold: "${why}"`, label: "YOUR CLICK" });
      state.banner = { id: r.id, ok: true, title: "On hold.", text: `Reason saved: "${why}". It stays in ${D.config.wording.lanes[r.lane].name} until someone picks it up.` };
      drawAll(); openPanel(r.id);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
    row.replaceChildren(input, el("button", { type: "button", class: "btn", onclick: save }, "Hold"));
    input.focus();
  } }, "Hold");
  row.append(start);
  return row;
}

function applyFix(r, f, what) {
  const before = r.flags.map((x) => x.check);
  state.fixes[r.id] = { ...(state.fixes[r.id] || {}), ...f };
  compute();
  const now = D.day.results.find((x) => x.id === r.id);
  const after = new Set(now.flags.map((x) => x.check));
  const closed = before.filter((c) => !after.has(c));
  const checkName = (c) => `"${D.config.checks.checks.find((x) => x.id === c).name}"`;
  const clicks = (state.clicks[r.id] ||= []);
  clicks.push({ text: what, label: "YOUR CLICK" });
  if (now.lane === "merged") {
    state.banner = { id: r.id, ok: true, title: "Merged.", text: `${now.card.merged_into} now carries both notes, so the business gets one call.` };
  } else if (closed.length) {
    clicks.push({ text: `Checks ran again: ${joinList(closed.map(checkName))} ${closed.length > 1 ? "pass" : "passes"}`, label: "CODE" });
    const moved = now.lane === "go_now" ? `Moved to Go now, number ${now.rank}.` : `Still ${D.config.wording.lanes[now.lane].name} for what's left.`;
    clicks.push({ text: now.lane === "go_now" ? "Flag closed. Moves to Go now" : "Flag closed", label: "CODE" });
    state.banner = { id: r.id, ok: true, title: `${joinList(closed.map(checkName))} ${closed.length > 1 ? "pass" : "passes"} now.`, text: `The check ran again on what you filled in. ${moved}` };
  } else {
    clicks.push({ text: "Checks ran again: still failing", label: "CODE" });
    state.banner = { id: r.id, ok: false, title: "Still failing.", text: "The check ran again on what you filled in and it doesn't pass yet, so the flag stays open." };
  }
  drawAll();
  openPanel(r.id);
}

function closePanel() {
  $("#panel").hidden = true; $("#scrim").hidden = true;
  state.open = null;
  state.banner = null;
  const id = state.opener && state.opener.dataset && state.opener.dataset.id;
  const again = id ? document.querySelector(`.lead-row[data-id="${id}"]`) : null;
  const target = again || (state.opener && document.contains(state.opener) ? state.opener : null) || document.querySelector("#l-tabs button.on");
  if (target) target.focus();
  state.opener = null;
}

// Keep Tab inside the open panel (it is a dialog).
function trapTab(e) {
  if (e.key !== "Tab" || $("#panel").hidden) return;
  const items = [...$("#panel").querySelectorAll("button, input, select, summary, [href], [tabindex]:not([tabindex='-1'])")].filter((n) => !n.disabled && n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === $("#panel") || document.activeElement === $("#fix-banner"))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

const idLink = (id, text) => el("a", { href: `?lead=${id}`, onclick: (e) => { e.preventDefault(); openPanel(id); } }, text);

// ---------- how it's checked ----------

function drawChecked() {
  const qs = D.config.questions.questions;
  $("#k-questions").replaceChildren(...Object.entries(qs).map(([id, q]) => el("li", {}, `${QNAME[id]}. `,
    el("span", { class: "why", text: `If unsure: ${UNSURE_WORD[q.unsure]}. ${q.unsure_why}` }))));
  $("#k-checks").replaceChildren(el("div", { class: "c head" }, el("span", { text: "Check" }), el("span", { text: "Runs on" }), el("span", { text: "Who fixes it" })),
    ...D.config.checks.checks.map((c) => el("div", { class: "c" },
      el("span", { text: c.name }), el("span", { class: "by", text: c.found_by === "code" ? "The form (plain code)" : "Jev's answer (plain code)" }),
      el("span", { class: "by", text: FIRST_CALL_CHECKS.has(c.id) ? "Licensed agent on the first call (a message if there's no working phone)" : c.owner_if_note_has_contact ? `${ownerLabel(c.owner_if_note_has_contact)} / ${ownerLabel(c.owner)}` : ownerLabel(c.owner) }))));

  const s = D.scores;
  const t = s.reading_totals;
  const g = D.config.rules.group_names;
  const answerWord = (a) => (a ? `Jev: ${a.answer === "unsure" ? `unsure${a.leaning ? `, leaning ${(g[a.leaning] || a.leaning).replaceAll("_", " ")}` : ""}` : (g[a.answer] || a.answer).replaceAll("_", " ")}, ${a.number.toFixed(2)}` : "no answer");
  const lanes = D.config.wording.lanes;
  const laneName = (l) => (lanes[l] ? lanes[l].name : l);
  const li = (id, rest) => el("li", {}, idLink(id, id), rest);
  const missedList = s.missed.filter((m) => m.found_by === "jev");
  const b = s.baseline;
  const rows = [
    ["Jev-read problems", el("span", {}, el("b", { text: `${s.jev.caught} of ${s.jev.total}` }), " caught",
      el("small", { text: "Caught means the right check fired on that lead, with the right owner. Jev was never tuned on these 100 leads. With only 29 problems, one miss moves the score a lot." }),
      missedList.length ? el("ul", { class: "missed-list" }, ...missedList.map((m) => li(m.id, `: ${m.kind.replaceAll("_", " ")} missed (${answerWord(m.jev_answer)}; the lead is in ${laneName(m.lane)})`))) : null)],
    ["False alarms", el("span", {}, el("b", { text: String(s.false_alarms.length) }), ` (${s.false_alarms_code} from code, ${s.false_alarms_jev} from Jev)`,
      s.false_alarms.length ? el("ul", { class: "missed-list" }, ...s.false_alarms.map((f) => li(f.id, `: ${f.check.replaceAll("_", " ")} (lead is in ${laneName(f.lane)})`))) : null)],
    ["Unsure answers", el("span", {}, el("b", { text: String(s.unsure_extra.length) }), " extra flags came from answers Jev was unsure about",
      s.unsure_extra.length ? el("ul", { class: "missed-list" }, ...s.unsure_extra.map((x) => li(x.id, `: ${x.check.replaceAll("_", " ")} (lead is in ${laneName(x.lane)})`))) : null,
      el("small", { text: `Clean leads taken out of Go now only because Jev was unsure: ${s.slowed.length}.` }))],
    ["Lead by lead", el("span", {}, el("b", { text: `${s.lead_level.same} of ${s.lead_level.total}` }), " leads land in the same lane, with the same owner, as they would with the answer key",
      b ? ` (simple rules: ${b.lead_level.same}).` : ".",
      s.lead_level_original_rule ? el("small", { text: `Under the lane rule in use when Jev read the leads, before questions a call can settle moved into Go now: Jev ${s.lead_level_original_rule.jev}, simple rules ${s.lead_level_original_rule.baseline}. The new lanes let more mistakes land harmlessly in Go now, for both.` }) : null,
      s.lead_level.differ.length ? el("ul", { class: "missed-list" }, ...s.lead_level.differ.map((x) => li(x.id, `: ${laneName(x.got)}, the key says ${laneName(x.want)}`))) : null)],
    ["Against simple rules", b ? el("span", {}, "Keyword rules plus the form's role box, no model: ", el("b", { text: `${b.jev.caught} of ${b.jev.total}` }), ` caught, with `, el("b", { text: `${b.false_alarms} false alarms` }), ` (Jev: ${s.false_alarms.length}).`,
      el("small", { text: `Their reading: ${b.reading_totals.right} of 700 answers right (Jev: ${t.right}). The rules were written after seeing the leads, so this flatters them.` })) : el("span", { text: "Not run." })],
    ["Code checks", el("span", {}, el("b", { text: `${s.code.caught} of ${s.code.total}` }), " simple problems found", el("small", { text: "Built and tested to catch exactly these, so this is a test, not a score." }))],
    ["Jev's reading", el("span", {}, el("b", { text: `${t.right} of ${t.answers}` }), ` answers right, ${t.confident_wrong} confident and wrong, ${t.unsure} unsure`,
      s.reading_totals_locked_key ? el("small", { text: `Against the answer key as it was locked: ${s.reading_totals_locked_key.right} of ${t.answers}. One key was corrected afterwards and is logged.` }) : null,
      el("details", { class: "more-info" }, el("summary", { text: "Question by question" }),
        el("div", { class: "table-scroll" }, el("table", {}, el("tr", {}, el("th", { text: "Question" }), el("th", { class: "num", text: "Right" }), el("th", { class: "num", text: "Wrong" }), el("th", { class: "num", text: "Unsure" })),
          ...Object.entries(s.reading).map(([q, v]) => el("tr", {}, el("td", { text: QNAME[q] }), el("td", { class: "num", text: String(v.right) }), el("td", { class: "num", text: String(v.confident_wrong) }), el("td", { class: "num", text: String(v.unsure) }))))),
        el("small", { text: "Jev often couldn't tell who wrote a third-person call note. An unsure answer there raises no flag, because every first call confirms who decides." })))],
  ];
  $("#k-scores").replaceChildren(...rows.map(([k, v]) => el("div", { class: "s" }, el("span", { class: "k", text: k }), el("span", { class: "v" }, v))),
    el("p", { class: "caption", text: "Scored on planted, made-up problems that were written to be clear-cut, so this is close to a best case. Real leads are messier, and real accuracy needs real leads." }));

  // Where they came from: problems per lead, by source.
  const bySource = {};
  for (const lead of D.leads) {
    const x = (bySource[lead.source] ||= { leads: 0, problems: 0, kinds: {} });
    x.leads++;
    for (const p of D.problemKey[lead.id]) { x.problems++; const k = p.kind.split(":")[0]; x.kinds[k] = (x.kinds[k] || 0) + 1; }
  }
  const ranked = Object.entries(bySource).map(([k, x]) => [k, x, x.problems / x.leads]).sort((a, b2) => b2[2] - a[2]);
  const [topSrc, top, rate] = ranked[0];
  const topKind = Object.entries(top.kinds).sort((a, b2) => b2[1] - a[1])[0][0];
  const others = ranked.slice(1).map(([k, x]) => `${SRC[k].toLowerCase()} ${x.problems} on ${x.leads}`).join(", ");
  $("#k-source").replaceChildren(`${SRC[topSrc]} leads had the most problems per lead: ${top.problems} on ${top.leads} (${rate.toFixed(2)} per lead; ${others}), most often "${D.config.wording.checks[topKind].row.toLowerCase()}". One upstream change to try: ${UPSTREAM[topKind]}. On made-up data this only shows how I'd look for the cause.`);

  $("#k-own").replaceChildren(el("p", {}, el("b", { text: "The numbers I'd own if this were real: " }), "the share of leads ready to quote within one business day, by lane; the share of Fix first leads that get recovered; and minutes to the first real conversation."),
    el("p", { text: "Not measured here: nobody uses this page." }));
  $("#k-lock").textContent = D.locked
    ? `The answer keys, rules and questions were fingerprinted before Jev's scored run (jev-answers.json, run.locked), and a test checks them. The lock commit is in a private working repo; the fingerprints are public. ${D.lockChanges.length} later changes are logged in order in lock-changes.json, each with its reason.`
    : "Jev hasn't read the scored leads yet.";
  $("#k-audit").textContent = D.audit
    ? `${D.audit.auditor}, labeled ${D.audit.leads} leads blind and agreed with the keys on ${D.audit.agreement_pct}% of answers before anything was settled. That shows the written rules are clear, not that the labels are right.`
    : "";
  $("#k-run").textContent = D.run
    ? `Jev (${D.run.model_asked}, TypeSafe) read all 100 leads on ${D.runDate} for about $${D.run.cost_dollars.toFixed(3)}, estimated from token counts at TypeSafe's listed price; ${(D.run.rereads || []).reduce((n, x) => n + x.leads.length, 0)} leads were re-read after their text was corrected. This page shows that saved run; it doesn't call Jev.`
    : "Design preview: Jev hasn't read these leads yet.";
}

function drawAll() {
  compute();
  drawHero();
  drawLeads();
}

async function main() {
  const [questions, rules, checks, wording, leadsFile, readingKey, problemKey, closedFile, lock, audit, jev, scores] = await Promise.all([
    getJSON("questions.json"), getJSON("rules.json"), getJSON("checks.json"), getJSON("wording.json"), getJSON("leads.json"),
    getJSON("reading-key.json"), getJSON("problem-key.json"), getJSON("closed.json"), getJSON("lock-changes.json"), getJSON("audit.json", true),
    getJSON("jev-answers.json", true), getJSON("scores.json", true)]);
  const leads = leadsFile.leads;
  const preview = !jev;
  const answers = preview ? Object.fromEntries(leads.map((l) => [l.id, perfectAnswers(readingKey[l.id])])) : jev.answers;
  D = { config: { questions, rules, checks, wording }, leads, readingKey, answers, meta: preview ? {} : jev.per_lead, closed: closedFile.closed || {},
    problemKey: Object.fromEntries(leads.map((l) => [l.id, problemKey[l.id]])), run: preview ? null : jev.run, runDate: preview ? null : jev.run.started.slice(0, 10),
    locked: preview ? null : jev.run.locked, lockChanges: lock.changes || [], audit: audit && audit.summary };
  $("#preview-note").hidden = !preview;
  compute();
  // The scores shown are a fresh scoring in the browser (the same code as score.mjs); scores.json only adds the baseline.
  const expected = runDay(D.config, leads, Object.fromEntries(leads.map((l) => [l.id, perfectAnswers(readingKey[l.id])])), { closed: D.closed });
  D.scores = { ...score(D.config, D.baseDay, D.problemKey, readingKey, expected), baseline: scores && scores.baseline,
    reading_totals_locked_key: scores && scores.reading_totals_locked_key, lead_level_original_rule: scores && scores.lead_level_original_rule };
  drawAll();
  drawChecked();
  $("#scrim").addEventListener("click", closePanel);
  const ask = new URLSearchParams(location.search).get("lead");
  if (ask && D.day.results.some((r) => r.id === ask)) openPanel(ask);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#panel").hidden) closePanel(); trapTab(e); });
}

main().catch((e) => { document.body.prepend(el("p", { class: "wrap", text: `Could not load the day: ${e.message}` })); });

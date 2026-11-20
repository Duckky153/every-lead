// The two animated figures on the "How it works" page. Each has two layouts, each on a fixed stage scaled to fit:
// a wide 960 x 540 stage (16:9, like a video) and, when the figure is narrower than 600 px, a tall portrait stage
// laid out again for a phone, so the text stays readable. Every frame is a pure function of time t.

const PORTRAIT_BELOW = 600;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const prog = (t, a, b) => ease(clamp((t - a) / (b - a)));
const lerp = (a, b, k) => a + (b - a) * k;

function h(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstChild;
}
function place(el, x, y, o = 1, s = 1) {
  el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  el.style.opacity = o;
  el.style.visibility = o > 0.005 ? "visible" : "hidden";
}

// Builds the figure for the box's current shape, scales it to fit, and builds it again when the box crosses
// the phone width. build(stage, portrait) returns { W, H, draw }.
function responsive(stage, build) {
  const box = stage.parentElement;
  let portrait = null, fig = null, last = 0;
  const fit = () => {
    const p = box.clientWidth < PORTRAIT_BELOW;
    if (p !== portrait) {
      portrait = p;
      stage.replaceChildren();
      stage.classList.toggle("portrait", p);
      fig = build(stage, p);
      stage.style.width = `${fig.W}px`;
      stage.style.height = `${fig.H}px`;
      fig.draw(last);
    }
    const k = box.clientWidth / fig.W;
    stage.style.transform = `scale(${k})`;
    box.style.height = `${fig.H * k}px`;
  };
  new ResizeObserver(fit).observe(box);
  fit();
  return (t) => { last = t; fig.draw(t); };
}

// ---------- one lead's morning (16 s) ----------
export const MORNING = 16;
// demo: { lead, message, rankAfter } for the lead the figure follows.
export function morning(stage, demo) {
  return responsive(stage, (st, portrait) => buildMorning(st, portrait, demo));
}

function buildMorning(stage, portrait, demo) {
  const lead = demo.lead;
  const W = portrait ? 400 : 960, H = portrait ? 800 : 540;
  const IN = portrait ? 20 : 48; // one inset on both sides
  const add = (html) => { const el = h(html); el.classList.add("abs"); el.style.left = "0"; el.style.top = "0"; stage.append(el); return el; };
  const clock = add(`<div class="mf-clock serif"><span class="t">7:14</span><span class="ap">AM</span></div>`);
  const ct = clock.querySelector(".t"), cap = clock.querySelector(".ap");
  clock.style.transformOrigin = "0 0";
  const card = add(`<div class="mf-card mf-lead">
      <div class="mf-top"><span class="mono">Web form</span><span class="mono">7:15 AM</span></div>
      <div class="name"></div>
      <div class="note">"I own a two-truck electrical shop, mostly panel upgrades and EV chargers around Tampa."</div>
      <div class="mf-row"><span class="mono">Phone</span><span class="val"></span><span class="mf-pill bad">Doesn't work</span><span class="mf-pill good">Works</span></div>
    </div>`);
  card.querySelector(".name").textContent = lead.business;
  const val = card.querySelector(".val"), bad = card.querySelector(".bad"), good = card.querySelector(".good");
  const reads = add(`<div class="mf-card mf-reads"><div class="mono head">Jev read it · 7 answers</div>
      <div class="r"><b>Business</b><span>building trades</span></div>
      <div class="r"><b>Who wrote it</b><span>the owner</span></div>
      <div class="r"><b>Coverage question</b><span>no</span></div>
      <div class="r"><b>When</b><span>not stated</span></div>
      <div class="r"><b>People</b><span>not stated</span></div>
      <div class="r"><b>Spam</b><span>no</span></div>
      <div class="r"><b>Orders to a computer</b><span>no</span></div></div>`);
  const rows = [...reads.querySelectorAll(".r")];
  const msg = add(`<div class="mf-card mf-msg"><div class="mono head">Message · draft, not sent</div><p></p></div>`);
  // The first two sentences of the real drafted message.
  msg.querySelector("p").textContent = (demo.message.match(/[^.?!]+[.?!]/g) || [demo.message]).slice(0, 2).join("").trim();
  const fix = add(`<div class="mf-pill bad mf-lane">Fix first · waiting on the customer</div>`);
  const go = add(`<div class="mf-pill good mf-lane"></div>`);
  go.textContent = `Go now · number ${demo.rankAfter}`;
  const tl = h(`<div class="abs mf-tl"><div class="line"></div><div class="fill"></div>
      <div class="dot d1"></div><div class="lab l1"><span class="mono">7:15 AM</span><b>Lead came in</b><small>Phone check failed</small></div>
      <div class="dot d2"></div><div class="lab l2"><span class="mono">Later</span><b>Number filled in</b><small>Moved to Go now</small></div>
      <span class="end mono" style="left:0">6 AM</span><span class="end mono" style="right:0">6 PM</span></div>`);
  stage.append(tl);
  for (let i = 1; i < 12; i++) { const k = h(`<div class="tick"></div>`); k.style.left = `${(100 * i) / 12}%`; tl.append(k); }
  const X1 = 10.4, X2 = 56;
  const q = (s) => tl.querySelector(s);
  q(".d1").style.left = `${X1}%`; q(".d2").style.left = `${X2}%`;
  q(".l1").style.left = portrait ? `${X1}%` : `${X1 + 3}%`; q(".l2").style.left = `${X2}%`;
  const sideW = portrait ? W - 2 * IN : 380;
  for (const el of [reads, msg]) el.style.width = `${sideW}px`;
  if (portrait) card.style.width = `${W - 2 * IN}px`;

  const draw = (t) => {
    // The clock starts big in the middle for a moment, then moves to the corner as the lead arrives.
    ct.textContent = t < 0.5 ? "7:14" : t < 10.4 ? "7:15" : "Later";
    cap.style.display = t < 10.4 ? "inline" : "none";
    const k = prog(t, 0.1, 0.6);
    const cw = clock.offsetWidth || 120;
    const big = portrait ? 1.6 : 1.8;
    clock.style.opacity = 1 - (t > 10.15 && t < 10.65 ? 1 - Math.abs(t - 10.4) / 0.25 : 0);
    place(clock, lerp((W - cw * big) / 2, W - IN - cw, k), lerp(portrait ? 300 : 190, portrait ? 18 : 22, k), clock.style.opacity, lerp(big, 1, k));
    // The lead card: in, then (wide) to the left while Jev reads, then back to the middle at the end.
    const cardY = portrait ? 70 : 92;
    const midX = (W - card.offsetWidth) / 2;
    const cx = portrait ? IN : t < 12.6 ? lerp(midX, IN, prog(t, 3.6, 4.2)) : lerp(IN, midX, prog(t, 12.6, 13.3));
    place(card, cx, lerp(cardY + 38, cardY, prog(t, 0.5, 1.1)), prog(t, 0.5, 1.1));
    const sideX = portrait ? IN : W - IN - sideW;
    const sideY = portrait ? cardY + card.offsetHeight + 16 : 80;
    place(reads, sideX, sideY, prog(t, 4.2, 4.6) * (1 - prog(t, 7.8, 8.1)), 1);
    rows.forEach((r, i) => { r.style.opacity = prog(t, 4.5 + i * 0.32, 4.8 + i * 0.32); });
    bad.style.display = t < 11.6 ? "inline" : "none";
    bad.style.opacity = prog(t, 7.1, 7.4);
    good.style.display = t >= 11.6 ? "inline" : "none";
    good.style.opacity = prog(t, 11.6, 11.9);
    const typed = "(904) 555-0162";
    val.textContent = t < 11.0 ? lead.phone : typed.slice(0, 13 + Math.round(clamp((t - 11.0) / 0.4)));
    // The message stays until the lead moves to Go now, so the frame never goes half empty.
    place(msg, sideX, portrait ? sideY : 110, prog(t, 8.1, 8.6) * (1 - prog(t, 11.9, 12.3)), 1);
    const laneY = portrait ? sideY + msg.offsetHeight + 18 : 352;
    place(fix, IN, laneY, prog(t, 8.7, 9.1) * (1 - prog(t, 11.6, 11.8)));
    const gw = go.offsetWidth || 200;
    const gx = portrait ? lerp(IN, (W - gw) / 2, prog(t, 12.6, 13.3)) : t < 12.6 ? IN : lerp(IN, (W - gw) / 2, prog(t, 12.6, 13.3));
    // On a phone the pill then rises to sit right under the card.
    place(go, gx, portrait ? lerp(laneY, sideY + 6, prog(t, 12.6, 13.3)) : laneY, prog(t, 11.9, 12.3));
    // The timeline.
    const fw = t < 10.4 ? X1 * prog(t, 0.1, 0.6) : X1 + (X2 - X1) * prog(t, 10.4, 11.6);
    q(".fill").style.width = `${fw}%`;
    q(".d1").style.opacity = prog(t, 0.5, 0.8); q(".l1").style.opacity = prog(t, 0.6, 1.0);
    q(".l1 small").style.opacity = prog(t, 7.2, 7.6);
    q(".d2").style.opacity = prog(t, 11.5, 11.8); q(".l2").style.opacity = prog(t, 11.7, 12.1);
    // A soft fade at the end of the loop.
    stage.style.opacity = 1 - prog(t, 15.5, 16);
  };
  return { W, H, draw };
}

// ---------- a hundred leads sorted (13 s) ----------
export const SORT = 13;
export function sorter(stage, results) {
  return responsive(stage, (st, portrait) => (portrait ? buildSortTall(st, results) : buildSortWide(st, results)));
}

// One order everywhere: Go now, Fix first, Check first. Each count is coloured like its dots.
const LANE_INFO = {
  go_now: { name: "Go now", sub: "call them, most urgent first", cls: "mf-go" },
  fix_first: { name: "Fix first", sub: "a call can't work it yet", cls: "mf-fix" },
  check_first: { name: "Check first", sub: "a person reads it", cls: "mf-chk" },
};

function sortDots(stage, results, lanes, add) {
  for (const L of Object.values(lanes)) L.n = 0;
  return results.map((r, i) => {
    const L = lanes[r.lane];
    const slot = L.n++;
    const d = add(`<span class="mf-dot ${L.cls}${r.lane === "go_now" && r.first_call.length ? " q" : ""}"></span>`, 0, 0);
    return { d, L, lane: r.lane, at: 0.6 + i * 0.068, sx: L.x + 29 + (slot % L.cols) * 26, sy: L.dotTop + Math.floor(slot / L.cols) * 26 };
  });
}

function buildSortWide(stage, results) {
  const W = 960, H = 540;
  const add = (html, x, y) => { const el = h(html); el.classList.add("abs"); el.style.left = `${x}px`; el.style.top = `${y}px`; stage.append(el); return el; };
  add(`<div class="mono">One made-up day · ${results.length} leads, in the order they came in</div>`, 48, 34);
  const counter = add(`<div class="mono" style="text-align:right;width:200px">0 of ${results.length} in</div>`, W - 248, 34);
  add(`<div class="mf-inlet"></div>`, 48, 112).style.width = `${W - 96}px`;
  const top = 160, height = 344;
  const lanes = {
    go_now: { x: 48, w: 468, ...LANE_INFO.go_now },
    fix_first: { x: 536, w: 196, ...LANE_INFO.fix_first },
    check_first: { x: 752, w: 160, ...LANE_INFO.check_first },
  };
  for (const L of Object.values(lanes)) {
    const box = add(`<div class="mf-lanebox"></div>`, L.x, top);
    box.style.width = `${L.w}px`; box.style.height = `${height}px`;
    L.cols = Math.floor((L.w - 30) / 26);
    L.dotTop = top + 136;
  }
  const key = add(`<div class="mf-key"><span class="mf-dot mf-go q"></span> with a question for the first call</div>`, 68, top + height - 40);
  const dots = sortDots(stage, results, lanes, add);
  // Each lane's heading sits on a band above the dots, so a dot drops in behind it, like a letter into a slot.
  for (const [k, L] of Object.entries(lanes)) {
    const band = add(`<div class="mf-laneband"><div class="ln">${L.name}</div><div class="num serif ${L.cls}">0</div><div class="sub">${L.sub}</div></div>`, L.x, top);
    band.style.width = `${L.w}px`;
    L.num = band.querySelector(".num");
    L.key = k;
  }
  const draw = (t) => {
    let landed = 0;
    const counts = { go_now: 0, fix_first: 0, check_first: 0 };
    for (const p of dots) {
      if (t < p.at) { p.d.style.opacity = 0; continue; }
      const a = prog(t, p.at, p.at + 0.42);            // slide along the line toward its lane
      const b = prog(t, p.at + 0.42, p.at + 1.0);      // then drop into its place
      const laneX = p.L.x + p.L.w / 2;
      const x = b > 0 ? lerp(laneX, p.sx, b) : lerp(48, laneX, a);
      const y = b > 0 ? lerp(112, p.sy, b) : 112;
      p.d.style.left = `${x}px`; p.d.style.top = `${y}px`;
      p.d.style.opacity = Math.min(1, (t - p.at) / 0.15);
      if (t >= p.at + 1.0) { landed++; counts[p.lane]++; }
    }
    for (const [k, L] of Object.entries(lanes)) L.num.textContent = counts[k];
    counter.textContent = `${landed} of ${results.length} in`;
    key.style.opacity = prog(t, 4, 4.6);
    stage.style.opacity = 1 - prog(t, 12.5, 13);
  };
  return { W, H, draw };
}

// Portrait: the three groups stacked, and a channel down the right side. Each dot drops down the channel to its
// row, then slides left into its place, so it never crosses a heading.
function buildSortTall(stage, results) {
  const W = 400, IN = 20, CH = 378;
  const add = (html, x, y) => { const el = h(html); el.classList.add("abs"); el.style.left = `${x}px`; el.style.top = `${y}px`; stage.append(el); return el; };
  add(`<div class="mono">One made-up day · ${results.length} leads</div>`, IN, 20);
  const counter = add(`<div class="mono">0 of ${results.length} in</div>`, IN, 46);
  const count = (lane) => results.filter((r) => r.lane === lane).length;
  const lanes = {};
  let y = 96;
  const w = CH - 22 - IN;
  for (const k of ["go_now", "fix_first", "check_first"]) {
    const L = { x: IN, w, ...LANE_INFO[k] };
    L.cols = Math.floor((w - 30) / 26);
    const rowsNeeded = Math.max(1, Math.ceil(count(k) / L.cols));
    const height = 84 + (rowsNeeded - 1) * 26 + 30;
    const box = add(`<div class="mf-lanebox"><div class="ln">${L.name}</div><div class="num serif ${L.cls}">0</div><div class="sub">${L.sub}</div></div>`, L.x, y);
    box.style.width = `${w}px`; box.style.height = `${height}px`;
    L.num = box.querySelector(".num");
    L.dotTop = y + 84;
    lanes[k] = L;
    y += height + 14;
  }
  const chan = add(`<div class="mf-chan"></div>`, CH, 86);
  chan.style.height = `${y - 14 - 86}px`;
  const key = add(`<div class="mf-key"><span class="mf-dot mf-go q"></span> with a question for the first call</div>`, IN, y + 4);
  const H = y + 48;
  const dots = sortDots(stage, results, lanes, add);
  const draw = (t) => {
    let landed = 0;
    const counts = { go_now: 0, fix_first: 0, check_first: 0 };
    for (const p of dots) {
      if (t < p.at) { p.d.style.opacity = 0; continue; }
      const a = prog(t, p.at, p.at + 0.42);            // drop down the channel to its row
      const b = prog(t, p.at + 0.42, p.at + 1.0);      // then slide left into its place
      const x = b > 0 ? lerp(CH, p.sx, b) : CH;
      const yy = b > 0 ? p.sy : lerp(86, p.sy, a);
      p.d.style.left = `${x}px`; p.d.style.top = `${yy}px`;
      p.d.style.opacity = Math.min(1, (t - p.at) / 0.15);
      if (t >= p.at + 1.0) { landed++; counts[p.lane]++; }
    }
    for (const [k, L] of Object.entries(lanes)) L.num.textContent = counts[k];
    counter.textContent = `${landed} of ${results.length} in`;
    key.style.opacity = prog(t, 4, 4.6);
    stage.style.opacity = 1 - prog(t, 12.5, 13);
  };
  return { W, H, draw };
}

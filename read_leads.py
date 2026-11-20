#!/usr/bin/env python3
"""Ask Jev (TypeSafe's model) the 7 fixed questions about what each made-up lead wrote, and save the answers.

Jev sees only {"lead": {"business_name", "what_they_wrote"}}: never the form, never the answer keys.
It answers with labels and numbers. It writes no text. Plain code (site/engine.js) makes every decision.

The public page never calls Jev; it loads the answers saved here. GitHub never calls Jev either.

Run on your own computer, with your own TypeSafe key in TYPESAFE_API_KEY (never printed or saved):
  python3 read_leads.py smoke              5 practice leads, to check the connection (about $0.0005)
  python3 read_leads.py practice           the 30 practice leads (used only to tune the questions)
  python3 read_leads.py scored             the 100 scored leads, once, after the answer keys are locked

Every paid attempt is logged in cache/spend.jsonl. Before each run the script works out the worst case
(every call as big as the largest call ever seen, 17,750 tokens) and refuses to start if that could cross the cap.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "site" / "data"
CACHE = HERE / "cache"
LEDGER = CACHE / "spend.jsonl"
ANSWER_CACHE = CACHE / "answers.jsonl"
URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.14.0"
PRICE_PER_TOKEN = 0.042 / 1_000_000  # docs.typesafe.ai/models, re-read 2026-11-19: $0.042 per million input tokens
WORST_TOKENS = 17_750  # largest single call in the owner's own Jev log
DEFAULT_CAP = 0.50
LOCKED_FILES = ["data/notes.json", "site/data/leads.json", "site/data/reading-key.json", "site/data/problem-key.json",
                "site/data/rules.json", "site/data/checks.json", "site/data/questions.json"]


class Refused(RuntimeError):
    pass


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def state_of(lead: dict) -> dict:
    return {"lead": {"business_name": lead["business"], "what_they_wrote": lead["what_they_wrote"]}}


def jev_questions(qfile: dict) -> dict:
    out = {}
    for qid, q in qfile["questions"].items():
        spec = {"type": q["type"], "instructions": q["instructions"]}
        if q["type"] == "choice":
            spec["criteria"] = q["criteria"]
        out[qid] = spec
    return out


def check_reply(reply: dict, qfile: dict) -> str | None:
    """Returns None if the reply is well formed, else what is wrong."""
    if reply.get("model") != MODEL:
        return f"model is {reply.get('model')!r}, not {MODEL}"
    usage = reply.get("usage") or {}
    if not isinstance(usage.get("input_tokens"), int) or usage["input_tokens"] <= 0:
        return "usage.input_tokens missing"
    answers = reply.get("answers")
    if not isinstance(answers, dict):
        return "no answers"
    for qid, q in qfile["questions"].items():
        a = answers.get(qid)
        if not isinstance(a, dict):
            return f"{qid} missing"
        if q["type"] == "noul":
            p = a.get("noul")
            if not isinstance(p, (int, float)) or not 0 <= p <= 1:
                return f"{qid} not a number between 0 and 1"
        else:
            if a.get("choice") not in q["criteria"]:
                return f"{qid} answer {a.get('choice')!r} is not an allowed option"
            c = a.get("confidence")
            if not isinstance(c, (int, float)) or not 0 <= c <= 1:
                return f"{qid} confidence not between 0 and 1"
            probs = a.get("probabilities") or {}
            if probs and abs(sum(probs.values()) - 1) > 0.01:
                return f"{qid} probabilities do not add to 1"
    return None


def spent(ledger: Path) -> float:
    if not ledger.exists():
        return 0.0
    tokens = sum(json.loads(l)["input_tokens"] for l in ledger.read_text().splitlines() if l.strip())
    return tokens * PRICE_PER_TOKEN


def cache_key(state: dict, questions: dict) -> str:
    return hashlib.sha256(json.dumps({"m": MODEL, "s": state, "q": questions}, sort_keys=True).encode()).hexdigest()


def load_cache() -> dict:
    if not ANSWER_CACHE.exists():
        return {}
    out = {}
    for line in ANSWER_CACHE.read_text().splitlines():
        if line.strip():
            d = json.loads(line)
            out[d["key"]] = d["reply"]
    return out


def post(body: bytes, key: str, opener=urllib.request.urlopen):
    req = urllib.request.Request(URL, data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with opener(req, timeout=60) as r:
        return json.loads(r.read())


def ask(lead: dict, questions: dict, key: str, tag: str, opener=urllib.request.urlopen, sleep=time.sleep):
    """One lead, one call. Only the network call is retried: up to 6 tries, waiting 2, 4, 8, 16, 32 seconds."""
    body = json.dumps({"model": MODEL, "state": state_of(lead), "questions": questions}).encode()
    delay, attempts = 2.0, 0
    while True:
        attempts += 1
        try:
            reply = post(body, key, opener)
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempts < 6:
                log_attempt(tag, lead["id"], None, "retry")
                sleep(delay); delay *= 2
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempts < 6:
                log_attempt(tag, lead["id"], None, "retry")
                sleep(delay); delay *= 2
                continue
            raise
    return reply, attempts


def log_attempt(tag: str, lead_id: str, tokens, outcome: str):
    CACHE.mkdir(exist_ok=True)
    estimated = tokens is None
    with LEDGER.open("a") as f:
        f.write(json.dumps({"t": round(time.time()), "tag": tag, "lead": lead_id, "outcome": outcome,
                            "input_tokens": WORST_TOKENS if estimated else tokens, "estimated": estimated}) + "\n")


def run(which: str, cap: float, other_ledgers: list[Path], key: str | None = None, opener=urllib.request.urlopen,
        sleep=time.sleep, git=subprocess.run) -> dict:
    qfile = json.loads((DATA / "questions.json").read_text())
    questions = jev_questions(qfile)
    source = DATA / ("leads.json" if which == "scored" else "practice-leads.json")
    leads = json.loads(source.read_text())["leads"]
    if which == "smoke":
        leads = leads[:5]
    locked = None
    if which == "scored":
        # The answer keys, rules and questions are fingerprinted and committed before Jev reads the scored leads.
        dirty = git(["git", "status", "--porcelain", "--", *LOCKED_FILES], cwd=HERE, capture_output=True, text=True).stdout.strip()
        if dirty:
            raise Refused(f"commit the locked files before the scored run:\n{dirty}")
        commit = git(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
        locked = {"commit": commit, "files": {f: sha(HERE / f) for f in LOCKED_FILES}}
    cache = load_cache() if which != "scored" else {}
    todo = [l for l in leads if cache_key(state_of(l), questions) not in cache]
    others = sum(spent(p) for p in other_ledgers)
    mine = spent(LEDGER)
    room = min(cap, 14.50 - others - mine) if other_ledgers else cap - mine
    worst = len(todo) * WORST_TOKENS * PRICE_PER_TOKEN
    if worst > room:
        raise Refused(f"worst case ${worst:.4f} for {len(todo)} calls is more than the ${room:.4f} left under the cap")
    key = key or os.environ.get("TYPESAFE_API_KEY")
    if todo and not key:
        raise Refused("TYPESAFE_API_KEY is not set (only needed to ask Jev; the page and the tests never need it)")
    started = time.strftime("%Y-%m-%dT%H:%M:%S")
    out, meta, errors, paid, tokens_total = {}, {}, [], 0, 0
    for lead in leads:
        k = cache_key(state_of(lead), questions)
        if k in cache:
            reply, attempts, cached = cache[k], 0, True
        else:
            t0 = time.strftime("%Y-%m-%d %H:%M")
            reply, attempts = ask(lead, questions, key, f"{which}:{qfile['version']}", opener, sleep)
            tokens = (reply.get("usage") or {}).get("input_tokens")
            log_attempt(f"{which}:{qfile['version']}", lead["id"], tokens if isinstance(tokens, int) and tokens > 0 else None, "ok")
            paid += 1
            tokens_total += tokens if isinstance(tokens, int) else WORST_TOKENS
            cached = False
            if which != "scored":
                with ANSWER_CACHE.open("a") as f:
                    f.write(json.dumps({"key": k, "reply": reply}) + "\n")
            meta[lead["id"]] = {"read_on": t0[:10], "tokens": tokens, "attempts": attempts}
        problem = check_reply(reply, qfile)
        if problem:
            errors.append({"lead": lead["id"], "problem": problem})
            out[lead["id"]] = None
        else:
            out[lead["id"]] = reply["answers"]
        if cached:
            meta.setdefault(lead["id"], {"read_on": None, "tokens": None, "attempts": 0, "cached": True})
    leads_fp = hashlib.sha256(json.dumps([state_of(l) for l in leads], sort_keys=True).encode()).hexdigest()
    run_info = {
        "model_asked": MODEL, "question_version": qfile["version"],
        "questions_fingerprint": hashlib.sha256(json.dumps(questions, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest(),
        "leads_fingerprint": leads_fp, "set": which, "started": started, "finished": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "calls_paid": paid, "calls_cached": len(leads) - paid, "errors": errors, "input_tokens": tokens_total,
        "price_per_million": 0.042, "price_read": "docs.typesafe.ai/models, 2026-11-19",
        "cost_dollars": round(tokens_total * PRICE_PER_TOKEN, 6), "cap_dollars": cap, "locked": locked,
    }
    return {"run": run_info, "answers": out, "per_lead": meta}


def reread(ids: list[str], reason: str, cap: float, other_ledgers: list[Path], key: str | None = None,
           opener=urllib.request.urlopen, sleep=time.sleep) -> dict:
    """Ask Jev again about named scored leads whose text changed after the lock (each change is logged in
    site/data/lock-changes.json). Only those leads are re-read; every other saved answer stays as it was."""
    saved = json.loads((DATA / "jev-answers.json").read_text())
    qfile = json.loads((DATA / "questions.json").read_text())
    if qfile["version"] != saved["run"]["question_version"]:
        raise Refused("the questions changed since the scored run; a re-read must use the same questions")
    questions = jev_questions(qfile)
    leads = {l["id"]: l for l in json.loads((DATA / "leads.json").read_text())["leads"]}
    missing = [i for i in ids if i not in leads]
    if missing:
        raise Refused(f"not scored leads: {missing}")
    others = sum(spent(p) for p in other_ledgers)
    room = min(cap, 14.50 - others - spent(LEDGER)) if other_ledgers else cap - spent(LEDGER)
    if len(ids) * WORST_TOKENS * PRICE_PER_TOKEN > room:
        raise Refused("the worst case is more than what is left under the cap")
    key = key or os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise Refused("TYPESAFE_API_KEY is not set")
    tokens_total, errors = 0, []
    for i in ids:
        t0 = time.strftime("%Y-%m-%d %H:%M")
        reply, attempts = ask(leads[i], questions, key, f"reread:{qfile['version']}", opener, sleep)
        tokens = (reply.get("usage") or {}).get("input_tokens")
        log_attempt(f"reread:{qfile['version']}", i, tokens if isinstance(tokens, int) and tokens > 0 else None, "ok")
        tokens_total += tokens if isinstance(tokens, int) else WORST_TOKENS
        problem = check_reply(reply, qfile)
        if problem:
            errors.append({"lead": i, "problem": problem})
        saved["answers"][i] = None if problem else reply["answers"]
        saved["per_lead"][i] = {"read_on": t0[:10], "tokens": tokens, "attempts": attempts, "reread": True,
                                "text_fingerprint": hashlib.sha256(json.dumps(state_of(leads[i]), sort_keys=True, separators=(",", ":"),
                                                                              ensure_ascii=False).encode()).hexdigest()}
    current = [state_of(leads[k]) for k in leads]
    saved["run"]["leads_fingerprint_current"] = hashlib.sha256(
        json.dumps(current, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    saved["run"].setdefault("rereads", []).append({"leads": ids, "reason": reason, "date": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                                   "input_tokens": tokens_total, "cost_dollars": round(tokens_total * PRICE_PER_TOKEN, 6),
                                                   "errors": errors})
    return saved


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("which", choices=["smoke", "practice", "scored", "reread"])
    ap.add_argument("--cap", type=float, default=float(os.environ.get("EVERY_LEAD_CAP_DOLLARS", DEFAULT_CAP)))
    ap.add_argument("--other-ledger", action="append", default=[], help="another Jev spend log sharing the same balance")
    ap.add_argument("--leads", default="", help="reread only: comma-separated lead ids")
    ap.add_argument("--reason", default="", help="reread only: why their text changed")
    a = ap.parse_args(argv)
    if a.which == "reread":
        try:
            saved = reread([x for x in a.leads.split(",") if x], a.reason, a.cap, [Path(p) for p in a.other_ledger])
        except Refused as e:
            print("refused:", e)
            return 2
        (DATA / "jev-answers.json").write_text(json.dumps(saved, indent=1) + "\n")
        last = saved["run"]["rereads"][-1]
        print(f"reread {len(last['leads'])} leads: {last['input_tokens']} tokens, about ${last['cost_dollars']:.4f}, {len(last['errors'])} errors")
        return 0
    try:
        result = run(a.which, a.cap, [Path(p) for p in a.other_ledger])
    except Refused as e:
        print("refused:", e)
        return 2
    name = {"scored": "jev-answers.json", "practice": "jev-practice-answers.json", "smoke": None}[a.which]
    r = result["run"]
    if name:
        (DATA / name).write_text(json.dumps(result, indent=1) + "\n")
    print(f"{a.which}: {r['calls_paid']} paid calls, {r['calls_cached']} from cache, {len(r['errors'])} errors, "
          f"{r['input_tokens']} tokens, about ${r['cost_dollars']:.4f}" + (f" -> site/data/{name}" if name else ""))
    for e in r["errors"]:
        print("  error:", e["lead"], e["problem"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

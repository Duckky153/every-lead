"""Tests for the made-up day: it is the same every time, realistic, and its answer keys come from the written leads.

Run: python3 -m pytest -q tests/
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"
sys.path.insert(0, str(ROOT))
import generate  # noqa: E402


def load(name):
    return json.loads((DATA / name).read_text())


def test_same_day_every_time(tmp_path, monkeypatch):
    before = {n: (DATA / n).read_text() for n in ("leads.json", "practice-leads.json", "reading-key.json", "problem-key.json")}
    generate.main([])
    for n, text in before.items():
        assert (DATA / n).read_text() == text, n


def test_counts_and_planted_problems():
    leads, practice = load("leads.json")["leads"], load("practice-leads.json")["leads"]
    pk = load("problem-key.json")
    assert len(leads) == 100 and len(practice) == 30
    scored = {l["id"]: pk[l["id"]] for l in leads}
    assert sum(1 for v in scored.values() if v) == 40
    assert sum(len(v) for v in scored.values()) == 44


def test_problem_key_equals_the_written_notes():
    notes = json.loads((ROOT / "data" / "notes.json").read_text())
    pk, rk = load("problem-key.json"), load("reading-key.json")
    for n in notes:
        assert pk[n["id"]] == [{"kind": p["kind"], "owner": p["owner"]} for p in n["problems"]]
        assert rk[n["id"]] == n["reading_key"]


def test_generator_never_runs_the_checks():
    src = (ROOT / "generate.py").read_text()
    assert "engine" not in src.replace("never runs the checks", "")
    assert "import" in src and "node" not in src


def test_seed_fills_only_neutral_fields():
    notes = {n["id"]: n for n in json.loads((ROOT / "data" / "notes.json").read_text())}
    for l in load("leads.json")["leads"] + load("practice-leads.json")["leads"]:
        n = notes[l["id"]]
        for k in ("business", "contact", "state", "industry_picked", "revenue_band", "coverage_wanted", "needed_by", "renews",
                  "employees", "sms_consent", "partner", "what_they_wrote", "source"):
            assert l[k] == n[k], (l["id"], k)


def test_realism_rules():
    leads = load("leads.json")["leads"] + load("practice-leads.json")["leads"]
    for l in leads:
        assert "07:00" <= l["came_in"] < "19:00"
        if l["needed_by"]:
            assert l["needed_by"] >= "2026-11-19"
        if l["renews"]:
            assert l["renews"] > "2026-11-19"
        assert (l["sms_consent"] is not None) == (l["source"] == "web_form")
        assert (l["employees"] is not None) == (l["source"] in ("phone_call", "website_chat"))
        if l["phone"]:
            assert re.search(r"555-01", l["phone"]), l["phone"]
        if l["email"] and "@" in l["email"] and l["email"].split("@")[1]:
            assert l["email"].split("@")[1] in ("example.com", "example.net", "example.org")
        for m in re.finditer(r"\b\d{3}[-. ]?(\d{3})[-. ]?(\d{4})\b", l["what_they_wrote"]):
            assert m.group(1) == "555" and m.group(2).startswith("01")


def _norm(s):
    import unicodedata
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()
    words = re.sub(r"[^a-z0-9 ]", " ", s).split()
    return " ".join(w for w in words if w not in ("llc", "inc", "co", "corp", "company", "the", "ltd"))


def _same_name(a, b):
    x, y = _norm(a), _norm(b)
    return bool(x and y) and (x == y or (len(x) >= 8 and x[0] == y[0] and _dist(x, y) == 1))


def _dist(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def test_no_unplanned_duplicates_and_planted_ones_differ_like_real_ones():
    pk = load("problem-key.json")
    for name in ("leads.json", "practice-leads.json"):
        leads = load(name)["leads"]
        for i, l in enumerate(leads):
            planted = any(p["kind"] == "duplicate" for p in pk[l["id"]])
            matches = [o for o in leads[:i] if (l["phone"] and l["phone"] == o["phone"] and len(re.sub(r"\D", "", l["phone"])) == 10)
                       or (l["email"] and l["email"] == o["email"] and l["email"].split("@")[1])
                       or (l["state"] == o["state"] and _same_name(l["business"], o["business"]))]
            assert bool(matches) == planted, l["id"]
            if planted:
                assert l["what_they_wrote"] != matches[0]["what_they_wrote"]


def test_no_lead_names_a_real_company():
    for name in ("leads.json", "practice-leads.json"):
        for l in load(name)["leads"]:
            for field in ("business", "what_they_wrote", "partner", "contact"):
                assert "harper" not in str(l[field] or "").lower(), (l["id"], field)
    notes = json.loads((ROOT / "data" / "notes.json").read_text())
    assert all("harper" not in json.dumps(n).lower() for n in notes)

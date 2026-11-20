#!/usr/bin/env python3
"""Make Every Lead's one sample day from the written leads.

Everything here is made up. Claude wrote each lead one at a time (data/notes.json): what the person wrote, the form
values that matter, and both answer keys. This script copies those as written. The fixed seed fills only neutral
fields: arrival times, phone numbers and emails. It never runs the checks, so the answer key is never made by the
rules checking themselves. (There is no city column: many notes name their own town, and a seeded city would
contradict them. The phone's area code comes from a city in the lead's state.)

Writes into site/data/:
  leads.json           the 100 scored leads, as the form and the intake team would see them
  practice-leads.json  30 practice leads, used only to tune the questions (never scored)
  reading-key.json     the true answer to each of Jev's 7 questions, per lead (Jev never sees this)
  problem-key.json     the planted problems per lead, or [] for a clean lead (the checks never read this)

Run:  python3 generate.py            (data/notes.json must exist)
      python3 generate.py --merge    (first merge data/batches/*.json into data/notes.json)
"""
import json
import random
import sys
from pathlib import Path

SEED = 1119
DAY = "2026-11-19"
HERE = Path(__file__).resolve().parent
NOTES = HERE / "data" / "notes.json"
OUT = HERE / "site" / "data"

CITIES = {
    "GA": [("Atlanta", "404"), ("Savannah", "912"), ("Macon", "478")],
    "TX": [("Austin", "512"), ("Houston", "713"), ("Fort Worth", "817")],
    "AZ": [("Phoenix", "602"), ("Tucson", "520"), ("Mesa", "480")],
    "NC": [("Charlotte", "704"), ("Raleigh", "919"), ("Asheville", "828")],
    "FL": [("Tampa", "813"), ("Orlando", "407"), ("Jacksonville", "904")],
    "CO": [("Denver", "303"), ("Colorado Springs", "719"), ("Fort Collins", "970")],
    "OH": [("Columbus", "614"), ("Cleveland", "216"), ("Dayton", "937")],
    "TN": [("Nashville", "615"), ("Memphis", "901"), ("Knoxville", "865")],
    "CA": [("Sacramento", "916"), ("Fresno", "559"), ("San Diego", "619")],
    "IL": [("Chicago", "312"), ("Peoria", "309"), ("Springfield", "217")],
}
EMAIL_DOMAINS = ["example.com", "example.net", "example.org"]
LEAD_FIELDS = ["id", "came_in", "source", "business", "contact", "role_typed", "phone", "email", "state",
               "industry_picked", "revenue_band", "coverage_wanted", "needed_by", "renews", "employees",
               "sms_consent", "partner", "what_they_wrote"]
KEY_FIELDS = ["what_business", "who_is_writing", "asks_coverage_question", "timing", "employees_in_text",
              "spam_or_test", "instructions_in_text"]


def merge():
    entries = []
    batches = sorted((HERE / "data" / "batches").glob("*.json"))
    if not batches:
        # The public copy has no batch files; merging would empty the day.
        raise SystemExit("no data/batches/*.json here: nothing to merge (data/notes.json is already the merged day)")
    for f in batches:
        entries += json.loads(f.read_text())
    entries.sort(key=lambda e: (e["set"] != "practice", e["id"]))
    NOTES.write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    print(f"merged {len(entries)} written leads into {NOTES.relative_to(HERE)}")


def times(rng, n):
    """n arrival times between 7:00 and 19:00, in order, with uneven gaps like a real day."""
    minutes = sorted(rng.sample(range(7 * 60, 19 * 60), n))
    return [f"{m // 60:02d}:{m % 60:02d}" for m in minutes]


def contact_values(e, rng, used_phones, area, used_emails):
    first, _, last = e["contact"].partition(" ")
    while True:
        line = f"01{rng.randrange(0, 100):02d}"
        number = f"({area}) 555-{line}"
        if number not in used_phones:
            used_phones.add(number)
            break
    handle = f"{first}.{last}".lower().replace("'", "").replace(" ", "")
    domain = rng.choice(EMAIL_DOMAINS)
    if any(u.split("@")[0] == handle for u in used_emails):
        # Two made-up people share a name: give the second a handle from the business, so no two emails match by chance.
        handle = (first + "." + "".join(e["business"].split()[:2])).lower().replace("'", "").replace("&", "")
    email = f"{handle}@{domain}"
    used_emails.add(email)
    return number, email, handle


def build(entries, rng, prefix):
    rows, reading, problems = [], {}, {}
    chosen = [e for e in entries if e["id"].startswith(prefix)]
    clock = times(rng, len(chosen))
    used_phones, used_emails = set(), set()
    by_id = {}
    for e, t in zip(chosen, clock):
        _city, area = rng.choice(CITIES[e["state"]])
        phone, email, handle = contact_values(e, rng, used_phones, area, used_emails)
        setup = e["contact_setup"]
        ph, em = setup["phone"], setup["email"]
        if ph == "missing":
            phone = ""
        elif ph == "nine_digits":
            phone = phone[:-1]
        elif ph == "has_letters":
            phone = phone[:-2] + "O" + phone[-1]
        elif ph.startswith("same_as:"):
            phone = by_id[ph.split(":")[1]]["phone"]
        if em == "missing":
            email = ""
        elif em == "broken":
            email = f"{handle}@"
        elif em.startswith("same_as:"):
            email = by_id[em.split(":")[1]]["email"]
        row = {k: e.get(k) for k in LEAD_FIELDS}
        row.update(came_in=t, phone=phone, email=email)
        by_id[e["id"]] = row
        rows.append(row)
        reading[e["id"]] = {k: e["reading_key"][k] for k in KEY_FIELDS}
        problems[e["id"]] = [{"kind": p["kind"], "owner": p["owner"]} for p in e["problems"]]
    return rows, reading, problems


def main(argv):
    if "--merge" in argv:
        merge()
    entries = json.loads(NOTES.read_text())
    rng = random.Random(SEED)
    scored, reading, problems = build(entries, rng, "L")
    practice, p_reading, p_problems = build(entries, rng, "P")
    OUT.mkdir(parents=True, exist_ok=True)
    day = {"day": DAY, "note": "Made-up leads written by Claude for a demo. Not real businesses or people."}
    (OUT / "leads.json").write_text(json.dumps({**day, "leads": scored}, indent=1, ensure_ascii=False) + "\n")
    (OUT / "practice-leads.json").write_text(json.dumps({**day, "leads": practice}, indent=1, ensure_ascii=False) + "\n")
    (OUT / "reading-key.json").write_text(json.dumps({**reading, **p_reading}, indent=1) + "\n")
    (OUT / "problem-key.json").write_text(json.dumps({**problems, **p_problems}, indent=1) + "\n")
    n = sum(len(v) for v in problems.values())
    planted = sum(1 for v in problems.values() if v)
    print(f"wrote {len(scored)} scored leads ({planted} with {n} planted problems) and {len(practice)} practice leads")


if __name__ == "__main__":
    main(sys.argv[1:])

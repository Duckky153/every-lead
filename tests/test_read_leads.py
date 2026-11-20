"""Tests for the Jev step, with Jev faked: no network, no key, no money.

Run: python3 -m pytest -q tests/
"""
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import read_leads  # noqa: E402

QFILE = json.loads((ROOT / "site" / "data" / "questions.json").read_text())


def good_reply(tokens=2400):
    answers = {}
    for qid, q in QFILE["questions"].items():
        if q["type"] == "noul":
            answers[qid] = {"noul": 0.02}
        else:
            first = next(iter(q["criteria"]))
            answers[qid] = {"choice": first, "confidence": 0.9, "probabilities": {first: 0.9, "other": 0.1}}
    return {"model": read_leads.MODEL, "answers": answers, "usage": {"input_tokens": tokens}}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def opener_returning(replies):
    calls = []

    def opener(req, timeout=60):
        calls.append(json.loads(req.data))
        r = replies.pop(0) if replies else good_reply()
        if isinstance(r, Exception):
            raise r
        return FakeResponse(json.dumps(r).encode())
    opener.calls = calls
    return opener


@pytest.fixture(autouse=True)
def temp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(read_leads, "CACHE", tmp_path)
    monkeypatch.setattr(read_leads, "LEDGER", tmp_path / "spend.jsonl")
    monkeypatch.setattr(read_leads, "ANSWER_CACHE", tmp_path / "answers.jsonl")
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)


def test_reply_checks():
    assert read_leads.check_reply(good_reply(), QFILE) is None
    bad = good_reply(); bad["usage"] = {}
    assert "input_tokens" in read_leads.check_reply(bad, QFILE)
    bad = good_reply(); bad["model"] = "other"
    assert "model" in read_leads.check_reply(bad, QFILE)
    bad = good_reply(); bad["answers"]["timing"]["choice"] = "someday"
    assert "allowed option" in read_leads.check_reply(bad, QFILE)
    bad = good_reply(); bad["answers"]["spam_or_test"]["noul"] = 1.5
    assert read_leads.check_reply(bad, QFILE)
    bad = good_reply(); del bad["answers"]["who_is_writing"]
    assert "missing" in read_leads.check_reply(bad, QFILE)


def test_jev_sees_only_the_name_and_what_they_wrote():
    op = opener_returning([])
    read_leads.run("smoke", 0.5, [], key="k", opener=op, sleep=lambda s: None)
    for body in op.calls:
        assert set(body["state"]["lead"]) == {"business_name", "what_they_wrote"}
        assert "reading_key" not in json.dumps(body) and "phone" not in body["state"]["lead"]


def test_cache_and_ledger():
    op = opener_returning([])
    r1 = read_leads.run("smoke", 0.5, [], key="k", opener=op, sleep=lambda s: None)
    assert r1["run"]["calls_paid"] == 5
    r2 = read_leads.run("smoke", 0.5, [], key="k", opener=opener_returning([]), sleep=lambda s: None)
    assert r2["run"]["calls_paid"] == 0 and r2["run"]["calls_cached"] == 5
    lines = read_leads.LEDGER.read_text().splitlines()
    assert len(lines) == 5 and all(json.loads(l)["input_tokens"] == 2400 for l in lines)


def test_missing_token_count_is_logged_as_estimated():
    reply = good_reply(); reply["usage"] = {}
    read_leads.run("smoke", 0.5, [], key="k", opener=opener_returning([reply]), sleep=lambda s: None)
    first = json.loads(read_leads.LEDGER.read_text().splitlines()[0])
    assert first["estimated"] is True and first["input_tokens"] == read_leads.WORST_TOKENS


def test_cap_refuses_before_spending():
    with pytest.raises(read_leads.Refused):
        read_leads.run("practice", 0.0001, [], key="k", opener=opener_returning([]), sleep=lambda s: None)
    assert not read_leads.LEDGER.exists()


def test_combined_limit_with_another_log(tmp_path):
    other = tmp_path / "other.jsonl"
    other.write_text(json.dumps({"input_tokens": int(14.499 / read_leads.PRICE_PER_TOKEN)}) + "\n")
    with pytest.raises(read_leads.Refused):
        read_leads.run("smoke", 0.5, [other], key="k", opener=opener_returning([]), sleep=lambda s: None)


def test_retries_network_errors_only_up_to_six_tries():
    err = urllib.error.HTTPError(read_leads.URL, 503, "busy", {}, io.BytesIO(b""))
    waits = []
    r = read_leads.run("smoke", 0.5, [], key="k", opener=opener_returning([err, err, good_reply()]), sleep=waits.append)
    assert waits == [2.0, 4.0] and r["per_lead"]["P001"]["attempts"] == 3
    with pytest.raises(urllib.error.HTTPError):
        read_leads.run("practice", 0.5, [], key="k", opener=opener_returning([err] * 6), sleep=lambda s: None)
    bad = urllib.error.HTTPError(read_leads.URL, 401, "no", {}, io.BytesIO(b""))
    with pytest.raises(urllib.error.HTTPError):
        read_leads.run("practice", 0.5, [], key="k", opener=opener_returning([bad]), sleep=lambda s: None)


def test_key_is_never_written(tmp_path):
    secret = "sk-test-SECRET-123"
    r = read_leads.run("smoke", 0.5, [], key=secret, opener=opener_returning([]), sleep=lambda s: None)
    assert secret not in json.dumps(r)
    for f in tmp_path.iterdir():
        assert secret not in f.read_text()


def test_no_key_means_a_clear_refusal():
    with pytest.raises(read_leads.Refused, match="TYPESAFE_API_KEY"):
        read_leads.run("smoke", 0.5, [], opener=opener_returning([]), sleep=lambda s: None)


def test_bad_reply_is_an_error_not_a_crash():
    bad = good_reply(); bad["answers"]["timing"]["choice"] = "someday"
    r = read_leads.run("smoke", 0.5, [], key="k", opener=opener_returning([bad]), sleep=lambda s: None)
    assert r["answers"]["P001"] is None and r["run"]["errors"][0]["lead"] == "P001"


def test_scored_run_needs_locked_files_committed():
    class Git:
        def __init__(self, dirty):
            self.dirty = dirty

        def __call__(self, args, **kw):
            out = (" M site/data/rules.json" if self.dirty else "") if "status" in args else "abc123"
            return type("R", (), {"stdout": out})()
    with pytest.raises(read_leads.Refused, match="commit"):
        read_leads.run("scored", 0.5, [], key="k", opener=opener_returning([]), sleep=lambda s: None, git=Git(True))
    r = read_leads.run("scored", 0.5, [], key="k", opener=opener_returning([]), sleep=lambda s: None, git=Git(False))
    assert r["run"]["locked"]["commit"] == "abc123" and len(r["run"]["locked"]["files"]) == 7
    assert r["run"]["calls_cached"] == 0


def test_reread_asks_only_the_named_leads_and_keeps_the_rest(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    real = ROOT / "site" / "data"
    for name in ("questions.json", "leads.json", "jev-answers.json"):
        (data / name).write_text((real / name).read_text())
    monkeypatch.setattr(read_leads, "DATA", data)
    before = json.loads((data / "jev-answers.json").read_text())
    op = opener_returning([])
    saved = read_leads.reread(["L008", "L021"], "test", 0.5, [], key="k", opener=op, sleep=lambda s: None)
    assert len(op.calls) == 2
    assert {c["state"]["lead"]["business_name"] for c in op.calls} == {
        l["business"] for l in json.loads((data / "leads.json").read_text())["leads"] if l["id"] in ("L008", "L021")}
    assert saved["answers"]["L001"] == before["answers"]["L001"]
    assert saved["per_lead"]["L008"]["reread"] is True
    assert saved["run"]["rereads"][-1]["leads"] == ["L008", "L021"]
    assert len(saved["run"]["leads_fingerprint_current"]) == 64
    with pytest.raises(read_leads.Refused):
        read_leads.reread(["P001"], "not scored", 0.5, [], key="k", opener=opener_returning([]), sleep=lambda s: None)


def test_reread_refuses_over_the_cap_or_without_a_key_and_logs_each_call(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    real = ROOT / "site" / "data"
    for name in ("questions.json", "leads.json", "jev-answers.json"):
        (data / name).write_text((real / name).read_text())
    monkeypatch.setattr(read_leads, "DATA", data)
    with pytest.raises(read_leads.Refused):
        read_leads.reread(["L008"], "cap", 0.0000001, [], key="k", opener=opener_returning([]), sleep=lambda s: None)
    with pytest.raises(read_leads.Refused, match="TYPESAFE_API_KEY"):
        read_leads.reread(["L008"], "no key", 0.5, [], opener=opener_returning([]), sleep=lambda s: None)
    assert not read_leads.LEDGER.exists()
    read_leads.reread(["L008", "L021"], "log", 0.5, [], key="k", opener=opener_returning([]), sleep=lambda s: None)
    rows = [json.loads(l) for l in read_leads.LEDGER.read_text().splitlines()]
    assert [r["lead"] for r in rows] == ["L008", "L021"] and all(r["tag"].startswith("reread:") for r in rows)

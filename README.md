# Every Lead

Every Lead sorts one day of 100 made-up insurance leads into three lanes:

- **Go now:** call them, most urgent first. If the first call can settle a question, that question goes with the lead as a first-call step. It might be the headcount, what the business does, who decides, or a coverage question for the licensed agent.
- **Fix first:** only the leads a call can't work yet. That means a phone that doesn't work, no way to reach them, a duplicate, or a question with no working phone to ask it on. Each one gets an owner and the exact fix. When the customer has to send something, it also gets a message.
- **Check first:** a person reads the lead before anyone acts. This happens when it looks like spam, tries to give orders to a computer, or Jev was unsure about something risky.

The tool drops no lead. Only a person can close one, and only with a reason.

This is an unofficial prototype and isn't affiliated with Harper. Every business, person, phone number and email is made up. Claude wrote each lead one at a time for this demo.

**Live page:** https://duckky153.github.io/every-lead/

![The Every Lead page](screenshots/page-desktop.png)

## What's on the page

- **The three lanes,** counted when the page loads: 81 go now (21 of them with a question for the first call), 13 get fixed first, and 6 wait for a person.
- **The leads.** Click a lead to see the problem and the fix first. Below that you'll see what the person wrote, what Jev read, the checks, and the steps the lead went through. Each step has a label:
  - MODEL: Jev's step
  - CODE: a plain-code step
  - NEXT: what happens next
  - PERSON: a real person's action
  - YOUR CLICK: something you did on the page, kept only in your browser
- **Try it:** open a lead in Fix first, fill in the fix, and watch the check run again.
- **How it's checked:** the evals, Jev's 7 questions, the checks, and where the planted problems came from.

## What's AI here, and what isn't

One step uses AI. Jev, TypeSafe's model, reads what each person wrote and answers 7 fixed questions with a label and a number. It writes no text.

Everything that decides is plain code: the checks, the lane, the owner, the order and the message.

Nothing runs on its own and nothing is sent. The day is made up, Jev's answers come from one saved run, and only a person closes a lead.

## How it works

- **What Jev sees:** only the business name and what the person wrote. It never sees the form or the answer keys.
- **What the numbers mean:** a yes/no number is Jev's chance of yes. A pick-one number is its confidence in that pick.
- **When Jev is unsure:**
  - On what the business does, or on orders to a computer, a person reads the lead.
  - An unsure coverage question counts as a question for the licensed agent.
  - Unsure spam counts as no, so the lead stays alive.
  - Who wrote it, the headcount and the timing raise no flag.
- **Answer keys locked before the scored run.** The keys, rules and questions were committed in a private working repo and fingerprinted before Jev read the 100 scored leads. The fingerprints are in `site/data/jev-answers.json` (`run.locked`), and a test checks them. Every later change is logged in order in `site/data/lock-changes.json`, with its reason.
- **Evals.** All of these are on planted, made-up problems that were written to be clear-cut, so they're close to a best case. Real leads are messier, and real accuracy needs real leads.
  - **Jev-read problems:** 28 of 29 caught, meaning the right check fired on that lead with the right owner.
    - The one miss was a relative writing for the business. Jev was unsure, and an unsure answer there raises no flag, because every first call confirms who decides.
    - There was 1 false alarm, and 4 extra flags came from answers Jev was unsure about.
    - With only 29 problems, one miss moves the score a lot.
  - **Against simple rules:** keyword rules plus the form's role box, with no model, caught 25 of 29 but raised 30 false alarms (Jev raised 1). The rules were written after seeing the leads, so this comparison flatters them.
  - **Lead by lead:** 98 of 100 leads land in the same lane, with the same owner, as they would with the answer key. The simple rules also get 98 here, because the new lanes let mistakes land harmlessly in Go now. Under the lane rule in use when Jev read the leads, it was Jev 96 and simple rules 68.
  - **Code checks:** 15 of 15. These checks were built to catch exactly these problems, so this is a test, not a score.
  - **Weak spot:** Jev often couldn't tell who wrote a third-person call note.
- **Label audit:** Codex, a different model, labeled 20 leads blind and agreed with the keys on every answer. That shows the written rules are clear, not that the labels are right.
- **Jev's saved run:** model `jev-1.14.0`, 2026-11-19. It cost about $0.006 for the 100 scored leads, estimated from token counts at TypeSafe's listed price. 13 leads were re-read after their text was corrected; see CHANGES.md. The page never calls Jev.

## Try it

Open https://duckky153.github.io/every-lead/. There's nothing to install.

## Run it on your own computer

You need Python 3 and Git.

```sh
git clone https://github.com/Duckky153/every-lead.git   # downloads this project into a folder called every-lead
cd every-lead                                            # moves into that folder
./run.sh                                                 # starts a small local web server
```

Then open http://127.0.0.1:5111/ in your browser. Press Control-C in the terminal to stop the server. If port 5111 is busy, run `PORT=5112 ./run.sh` and open http://127.0.0.1:5112/ instead.

## Tests

You need Node.js 20 or newer and Python 3. Run these from the `every-lead` folder.

```sh
node --test tests/
```

This checks the lanes, steps, handoff cards, messages and evals, and re-sorts all 100 leads from the saved answers.

```sh
python3 -m venv .venv && .venv/bin/pip install pytest && .venv/bin/python -m pytest -q tests/
```

This checks that the made-up day comes out the same every time and is realistic. It also tests the Jev step with Jev faked, so no key and no network are needed.

GitHub runs both before every update.

Two more scripts need no key and no network:
- `node score.mjs` scores the saved run again.
- `node baseline.mjs` rebuilds the simple-rules answers.

## Limits

- The leads are made up, and 40 of the 100 have problems planted on purpose.
- The checks only find the kinds of problem listed on the page.
- The scores are on planted problems.
- Nobody uses this page.
- It gives no insurance advice, and nothing is sent to anyone.

Built by Dakshit Raj with Claude Code and Jev.

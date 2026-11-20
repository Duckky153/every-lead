# What changed, and why

Only changes that really happened, with real numbers.

## 2026-11-19

- **Leads written.** Claude wrote 130 made-up leads one at a time: 30 practice leads and 100 scored leads. Each one
  came with its form values and both answer keys. Four Claude sessions wrote in parallel, and every batch was checked
  against the written rules (`data/WRITING-RULES.md`).
- **Rules made clearer while the leads were being written, before any Jev call.** The writers flagged unclear
  points, so these rules were added:
  - Who counts as the writer of a partner email.
  - Asking for a quote is not a question about cost.
  - "Right away" means within 7 days.
  - How to count a crew.
  - Spam leads carry no other content problems.
- **Generator fix, before any Jev call.** Two made-up people shared a name, so they got the same email by chance.
  That produced a false duplicate. A second person with the same name now gets an email made from the business name.
- **Label audit.** Codex (OpenAI) labeled 20 randomly drawn scored leads blind, using only the rules, the form and
  the note. It agreed with the keys on 140 of 140 answers and 20 of 20 problem lists. Nothing needed settling.
- **Rules on the right answers.** Using the reading key in place of Jev, the checks found 44 of 44 planted problems
  with 0 false flags. This is a test, not a score: it proves the checks work when the answers are right.
- **Jev practice run.** Jev read the 30 practice leads with questions `el-v1` and caught 13 of 13 problems, with no
  false alarms. The questions and thresholds were not changed (0 tuning rounds).
- **Lock.** The answer keys, rules, checks and questions were committed in the private working repo and
  fingerprinted before the scored run. The fingerprints are in `site/data/jev-answers.json` (`run.locked`), and a test
  checks them. Later changes are logged below and in `site/data/lock-changes.json` (11 so far).
- **Jev scored run.** Jev read the 100 scored leads once:
  - 142,829 tokens, about $0.006.
  - 0 errors.
  - 28 of the 29 Jev-read problems caught.
  - 1 missed. L083 is a relative writing for the business. Jev was unsure (0.29), so by design no flag was raised,
    and the lead is in Go now.
  - 1 false alarm. L030 was read as asking a coverage question (0.85).
  - 1 clean lead slowed. L060 got an unsure coverage answer and went to a licensed teammate.
- **Cost of every Jev call in this build:** 5 smoke-test calls (a 5-lead trial), 25 practice and 100 scored calls, 185,686 tokens in all, about
  $0.008.

## 2026-11-19, after an independent review

A fresh reviewer checked the build before publishing. It found 2 blockers, 9 major and 20 minor issues. All were fixed, then a second review of the fixes found 4 partly fixed and 9 new issues, also fixed. The changes to locked files are logged in `site/data/lock-changes.json` with their fingerprints:

- **Four lead notes named Harper.** L008, L021, L087 and L091 named a real company in their own text. "Harper" became "you". Jev re-read those 4 leads with the same questions: 5,853 tokens, about $0.0002. The headline numbers didn't change.
- **One key was wrong.** L030's "who wrote it" was keyed "can't tell", but "just me and my sister" read as the owners. The key now says owner. This raised Jev's reading score by 1 answer: 631 became 632 of 700.
- **The city column was removed.** The seeded city contradicted the town many notes name. Jev never sees the city, so no score moved.
- **The page changed but the scoring didn't:**
  - The phone layout was fixed.
  - Misses, false alarms and slowed leads are clickable and show Jev's answer.
  - A question-by-question table was added.
  - A merged duplicate now leaves the lanes.
  - Card and message wording were fixed.
  - Owner names read "A teammate can fix" instead of an internal name.
- **Jev's reading, question by question:** "who wrote it" was the weak spot, with 61 right, 9 confident and wrong and 30 unsure (after the L030 key fix). Jev often answered "can't tell" on third-person call notes. By design that raises no flag, and the first call confirms who decides.
- **Two more leads went to a person.** L030 and L053, which do have planted problems, were also sent to a person first, because Jev was unsure whether the note gave orders to a computer. That's why Check first holds 6, not 4.
- **Still close to a best case.** The planted problems were written to be clear-cut, so these scores are close to a best case; real leads are messier.
- **Every Jev call in this build:** 5 smoke, 25 practice, 100 scored and 4 re-read calls, about $0.008 in all.

## 2026-11-20, after five more reviews

Five more reviewers each looked at one area: operations, AI engineering, truth and licensing, first-visit use, and the publish path.

- **Fix first now holds only what a call can't solve.**
  - The operations review pointed out that 26 of the 34 Fix first leads had a working phone. Some larger businesses got an email instead of a call.
  - Now, when a lead has a working phone, its question goes with it into Go now as a first-call step. Those questions are headcount, what the business does, who decides, and a coverage question for the licensed agent.
  - Without a working phone, the question goes into a message, as before.
  - The lanes went from 60 / 6 / 34 to 81 / 6 / 13. Jev-read problems stay at 28 of 29.
- **Made-up names that matched real ones were replaced.**
  - Contacts that shared names with well-known people: L022, L039, L056, L063, L069, L072 and L092. Contact names on the form aren't shown to Jev, so these needed no re-read on their own.
  - Partner and spam names that are real companies: Keystone Payroll, RankRocket and RankLift.
  - Two duplicate notes (L063 and L086) now name the same town as their originals.
  - The old internal owner name for fixes that need no customer became "Teammate can fix".
  - Jev re-read the 7 scored leads whose note text changed (L022, L039, L042, L061, L063, L079 and L086), for 10,081 tokens (about $0.0004).
  - Two practice leads (P003, P013) changed names too. They were used only for tuning and weren't re-read, so their saved practice answers are from before the rename.
- **Fixes:**
  - Phones in any common format now count.
  - A number written in a note is found in more formats.
  - Duplicate names ignore suffixes like "LLC", and "one letter apart" applies only to longer names that start the same.
  - Fill in the fix rejects bad values (a headcount must be a whole number, and a sign-off needs a name).
  - A licensed agent's confirmed business type now closes that flag, because their call wins over the model.
  - Merging after typing a phone works, and the earlier lead keeps the duplicate's urgency and note.
  - "Dropped by the tool" is counted, not typed in.
- **New evals:**
  - A simple-rules baseline (keyword rules plus the form's role box, no model) caught 25 of 29 with 30 false alarms. Jev had 1. The rules were written after seeing the leads, so this flatters them.
  - A lead-by-lead check: 98 of 100 leads land where the answer key puts them.
  - Jev's reading against the key as it was locked: 630 of 700. It's 631 now, after the logged L030 key fix and the re-reads.
- **The lock log was rebuilt in order from git history.** Each change to a locked file is listed with its before and after fingerprints. In round 4 its reasons were reworded to keep private words out; new entries are added at the end.
- **On the page:**
  - A result banner shows at the top of the panel after a fix.
  - The fix box sits right under the problem, and Close stays visible.
  - A plain line explains Jev.
  - Jev's numbers are labeled as a chance of yes or as confidence.
  - The hero and the lower sections are shorter.
  - The list drops the repeated "Who" column.
  - The banned-words list is shorter. A separate private check keeps company names and local paths out of the public files.
- **Things not changed, and why:**
  - Rewording the "who wrote it" question, adding up its probabilities, or using the form's role box inside the checks would all be decisions made after seeing the scored answers. They are listed as next steps, not applied to this run.

## 2026-11-20, round 4 (two verifiers)

- **Two notes still named a real payroll company.** L006 and L041 said "Keystone" in their text. It became the made-up Fernvale, and Jev re-read both leads: 2,877 tokens, about $0.0001. No score moved.
- **Public files no longer carry private words.** An old internal owner name and the company's name were removed from the change log, the lock log and the saved run's notes, so the publish check passes.
- **Things changed after the scored run, said plainly:**
  - **The lane rule.** In round 3, questions a call can settle moved into Go now. That moved two numbers in Jev's favor: lead by lead went from 96 to 98, and clean leads slowed went from 1 to 0. Under the original rule the simple rules scored 68 lead by lead; under the new one they score 98 too, so that number no longer separates Jev from the rules. The page shows both.
  - **The phone rule.** Any common phone format now counts. The made-up phones all use one format, so no score moved.
  - **The catch definition.** Round 3 briefly dropped the owner from "caught". It's back to the definition in use when Jev read the leads (the right check, on that lead, with the right owner). No score moved.
- **A re-read changed one answer.** In round 3, Jev's re-read of L079 lowered its confidence about what the business does from 0.73 to 0.67, below the 0.70 line. That counts as unsure, which added a fourth unsure flag and moved the reading total from 632 to 631. L079 is in Fix first because its phone doesn't work.
- **The headline changed** from "The clean ones go now" to "Most go now", because 21 of the 81 Go now leads carry a question for the first call (20 planted problems and 1 unsure answer, on L060).
- **Fixes:**
  - A merged duplicate's urgency no longer breaks the order of the Go now list.
  - The business type a customer gives is checked against the one they picked.
  - Each lead now has a fingerprint of exactly the text Jev last read, so an edited lead that wasn't re-read fails a test.
- **Not changed, on purpose:**
  - The timing question stays. It only sets the order of the Go now list, and in this data every urgent lead also had a date on the form, so it changed nothing here.
  - The look stays plain cream and navy. The footer that said it isn't affiliated with the company was later removed; the header tag and the README still say it's an unofficial prototype.
  - The page doesn't describe a full automation plan for the clean leads. It shows the sorting step only.
- **Every Jev call in this build:** 5 smoke, 25 practice, 100 scored and 13 re-read calls, about $0.008 in all.

## 2026-11-20, round 5 (plain words, look, video)

Three more reviews: plain language for a busy reader who isn't technical, the look on a laptop and a phone, and the demo video. No locked file, saved answer or score changed; `node score.mjs` prints the same numbers.

- **One order everywhere:** Go now, Fix first, Check first, on the hero, the tabs, the text, the write-up, the figure and the video.
- **The main page says what it is.** A line under the headline says these are small-business insurance leads, who to call now, what to fix first and what a person reads first. The headline is now "Most go now. The rest get a clear next step.", because the 6 Check first leads aren't fixed, they're read. "Jev reads, plain code decides" is said once.
- **Plain words on the page:** "lane" became "group", "flag" became "problem", "owner" became who it's waiting on, "Evals" became "How well it did", "planted" became "given problems on purpose", and Jev's numbers read as percents ("98% sure", "4% chance of yes"). The fix button reads "Save and re-check", and "Hold" reads "Put on hold".
- **The fix line on every Fix first card is one complete sentence.** It used to add "The flag closes only if the check passes." after each line, which contradicted the merge line on duplicates.
- **The run line counts the re-reads.** It now says 13 leads were re-read after small text fixes, which is why some panels say they were read on 2026-11-20. The number comes from the saved run.
- **The animated figures have a tall phone layout.** Below 600 px each figure is laid out again on a 400 px wide stage, so its text stays readable on a phone instead of shrinking the laptop frame to a third.
- **Smaller look fixes:** the page no longer jumps when the data loads, the "Next" heading lines up with its column, the panel no longer repeats itself after a merge or a hold, the fix banner has no heavy outline, phone numbers don't break across lines, the email address in the message label keeps its normal case, phone tap targets are 44 px, and the header no longer sticks on a phone.
- **The video was rendered again from the final page,** with clearer captions for the opening question, the Check first reasons and the scores ("Simple keyword rules caught 25, with 30 false alarms"), and the pointer and highlight fixes from the video review.

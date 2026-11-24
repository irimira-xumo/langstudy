# LangStudy

A personal study notebook for **German** (refresh → Goethe-Zertifikat B2, December 2026) and **Italian** (zero → CILS A2, June 2027).

It is a plain static website: HTML, CSS and vanilla JavaScript, no build step, no backend, no API keys. It runs on GitHub Pages and works on desktop and phone.

## What it does

- **Today** – opens on today's German unit, today's Italian unit, the review items due, and any unfinished German tests.
- **Language switcher** (Deutsch / Italiano) with a progress bar and a unit path showing each unit as *done*, *in progress*, *current* or *locked*.
- **Units** – 14 German units and 12 Italian units. Each unit has these tabs:
  - **Study**: short grammar notes with examples, plus 13–15 vocabulary items with English meanings.
  - **Practice**: 9–11 exercises, mostly writing: fill in, rewrite, translate, short free writing and a reading passage with English questions.
  - **Test**: 6 written questions that decide progression.
  - **Review**: answers you got wrong or partly right come back after 1 day. Get one right and it comes back after 3 days, then 7 days, then it is cleared. Get it wrong again and it returns the next day.
  - **Unfinished** (German only): every German test you started but didn't submit waits here until you finish it.
- **Checking**
  - Short answers are checked instantly. Case, punctuation and extra spaces are ignored. If the only difference is a missing umlaut or accent (ä → a or ae, ß → ss, è → e), the answer counts as correct with a warning. You can turn that off in the ⋯ menu.
  - If you are sure your wording is also right, **My answer is also correct** counts it.
  - Longer written answers show your answer and the model answer side by side, and you mark yourself *correct*, *partly* or *wrong*.
  - **Ask Claude to correct** (on every exercise) copies a ready-made prompt with the unit, the question, the reading passage if there is one, your answer and the model answer. Paste it into Claude to get corrections with short English explanations.
- **Progression**
  - German: a unit is done when its test score is **70% or higher**. Otherwise you are offered a retake, and the next unit stays locked.
  - Italian: the next unit unlocks as soon as you have **attempted** the current unit's test, whatever the score. Until then, Today asks you to repeat the lesson.
- **Audio**: a 🔊 button on every example, vocabulary item and reading passage uses your browser's built-in speech (de-DE / it-IT voices). The buttons are hidden if your device has no voice for that language.
- **Saving**: progress is stored in your browser (localStorage). Use **⋯ → Export progress** to download a backup file, and **Import…** to load it on another device or browser.
- Light and dark mode (automatic, or choose in the ⋯ menu), large tap targets, works at phone width.

## Put it online with GitHub Pages (step by step)

1. On GitHub, open this repository: `https://github.com/irimira-xumo/langstudy`.
2. Click **Settings** (the gear tab at the top of the repository).
3. In the left sidebar, click **Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Under **Branch**, choose **main** and the folder **/ (root)**, then click **Save**.
6. Wait a minute or two, then refresh the Pages settings page. It shows the address of your site, which will be **https://irimira-xumo.github.io/langstudy/**.
7. Open that address on your phone and add it to your home screen (Safari: Share → *Add to Home Screen*; Chrome: ⋮ → *Add to Home screen*).

Every time a new commit lands on `main`, the site updates by itself within a few minutes.

Your progress lives in the browser you study in, so the phone and the laptop each keep their own copy. To move progress between them, export on one device and import on the other.

## Try it on your own computer

Browsers refuse to load the JSON files when you double-click `index.html`, so start a tiny local server in the repository folder instead:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Adding or editing units

All course content is in two files: `data/german.json` and `data/italian.json`. Edit them on GitHub (open the file, click the ✏️ pencil, make the change, **Commit changes**) or in any text editor.

Each file looks like this:

```jsonc
{
  "language": "German", "code": "de", "speechLang": "de-DE",
  "goal": "Goethe-Zertifikat B2", "examDate": "December 2026",
  "progression": "score",   // "score": pass mark needed; "attempt": any attempt unlocks the next unit
  "passMark": 70,
  "units": [ /* units, in order */ ]
}
```

A unit:

```jsonc
{
  "id": "de03",                 // unique; don't change it once you have progress (progress is stored by id)
  "title": "The dative case",
  "level": "A2",
  "summary": "One sentence shown at the top of the Study tab.",
  "schedule": "Week 2",         // optional label linking the unit to the syllabus
  "notes": [
    { "heading": "Dative articles", "text": "der → dem, …",
      "examples": [ { "t": "Ich gebe dem Kind einen Apfel.", "en": "I give the child an apple." } ] }
  ],
  "vocab": [ { "term": "helfen (hilft) + Dat.", "en": "to help" } ],
  "practice": [ /* exercises */ ],
  "test": [ /* exercises (no reading type) */ ]
}
```

Exercises (`id`s are `p1`, `p2`, … in practice and `t1`, `t2`, … in tests; the order is the order shown):

```jsonc
// checked automatically: type "fill", "transform" or "translate", with "check": "auto"
{ "id": "p1", "type": "fill", "prompt": "Ich fahre mit ___ Bus. (der)",
  "answer": "dem", "alternatives": [], "check": "auto" }

{ "id": "p5", "type": "transform", "instruction": "Join the sentences with weil.",
  "prompt": "Ich lerne Deutsch. Ich will in Wien arbeiten.",
  "answer": "Ich lerne Deutsch, weil ich in Wien arbeiten will.", "alternatives": [], "check": "auto" }

{ "id": "p7", "type": "translate", "prompt": "The bag belongs to my sister.",
  "answer": "Die Tasche gehört meiner Schwester.", "alternatives": ["…another correct version…"], "check": "auto" }

// self-marked: free writing
{ "id": "p8", "type": "write", "prompt": "Describe your morning in 4 sentences.",
  "answer": "Model answer here.", "alternatives": [], "check": "self" }

// reading: one passage with several self-marked questions (ids p9a, p9b, …)
{ "id": "p9", "type": "reading", "title": "Mia zieht um", "passage": "60–120 words …",
  "glossary": [ { "term": "hell", "en": "bright" } ],
  "questions": [ { "id": "p9a", "prompt": "What is the flat like?", "answer": "Small but bright.", "check": "self" } ] }
```

Tips:

- `instruction` is optional. Without it the app writes a sensible default ("Translate into German.", "Fill in the blank.").
- For auto-checked items, list every acceptable wording in `alternatives`. Matching ignores case, punctuation and spacing, so you don't need variants for those.
- Keep `"check": "self"` for anything open-ended: there are too many correct answers to list.
- To add a unit, copy an existing unit, give it a new `id`, and put it where it belongs in the `units` list.
- JSON is strict: use double quotes, no comma after the last item. If the site shows "Could not load the course files", paste the file into a JSON validator to find the typo.

## Assumptions I made

- **Units are sequential.** Only the current unit and finished units can be opened. "Current" means not started yet; "in progress" means you have practised, started the test or have a test score below the pass mark.
- **"Today's unit"** is simply the first unfinished unit in each language. The syllabus week or month is shown as a label, but the app doesn't move you on by calendar date.
- **Test scoring**: automatically checked answers count 1 or 0; self-marked answers count 1 (correct), ½ (partly) or 0 (wrong). An empty answer counts as wrong. The score is rounded to a whole percentage. Every missed test question goes into Review.
- **A German test** counts as *unfinished* from the moment you press **Start test** until you finish marking it. Italian tests are saved the same way but not listed in an Unfinished tab, because you only asked for one in German.
- **Umlaut and accent leniency** is on by default and such answers count as correct (with a warning). Turn it off in the ⋯ menu for strict spelling.
- **Review** only includes answers marked wrong or partly right. Practising an item correctly again in the Practice tab doesn't move its review date; only the Review tab does. You can change your mind about a mark on the same visit and the schedule is corrected.
- **Italian first-person model answers** use the feminine form (*sono coreana, sono andata*). The masculine form is listed as an alternative where it matters.
- **Italian unit 1** teaches *Mi chiamo…, Come stai?* as fixed phrases. The grammar behind them comes in units 9 and 10. Apart from such phrases, Italian exercises use only grammar from the same or earlier units.
- **Coverage**: the 14 German units cover the grammar in syllabus weeks 1–9. Comparatives, reflexive verbs (week 4), participle phrases (week 9) and nominalisation (week 8) only appear in passing and could become extra units. The 12 Italian units cover October to January of the syllabus. Possessives (December) and February–May topics (imperfetto, object pronouns, futuro, imperativo, condizionale) are not yet included.
- **Progress is per browser.** Clearing site data deletes it, so export a backup now and then.
- **Speech** uses whatever German and Italian voices your device has. Quality varies by device. On a computer with no such voice, the 🔊 buttons stay hidden.

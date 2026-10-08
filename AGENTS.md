# BridgeLine — instructions for the AI agent

Read `README.md` (overview, safety, addressing, limitations), `docs/PANEL.md` (what the user sees) and `docs/COMMANDS.md` (all commands) before working.
Commands are sent with `python3 aeb.py <command> '<json args>' --project "<path to the .aep>"`.

On Windows:
- Python is usually `python` or `py`, not `python3`.
- Windows PowerShell 5.1 strips the double quotes from JSON passed to native programs. In PowerShell, write the args to a
  file and use `--args-file args.json`; in Git Bash or cmd the normal quoting works.
- Pass Windows paths as they are (`--project "C:\Work\Proj.aep"`); the panel compares paths without case.

## Working with the user
- **Updates:** if a `ping` result has an `update` field, tell the user in one line and offer to update:
  `git pull` in the bridge folder (skip if it is not a git clone: then point to the releases page), then ask the user
  to run `./install.sh` (macOS) or `install.ps1` (Windows) and reopen the panel, and `ping` again to confirm the version.
- Answer in the user's language.
- **Real projects:**
  1. Read the state first (`ping`, `compInfo`, `dumpComp`, `renderFrames`, `activeState`, `getNotes`).
  2. Show a plan of changes and wait for the user's approval.
  3. Ask the user to tick **Allow changes** in the panel.
  4. Run the commands.
  5. Verify by reading back + `renderFrames`.
- Never run `startRender`, `queueInAME`, `saveProject`, `cleanupProject` or `menuCommand incrementAndSave` without asking first.
- When the user says "stop", stop and run nothing.
- `tests/run_tests.py` creates and deletes comps. Run it only on an empty test project, never on a real one.
- Installing the panel needs administrator rights (sudo on macOS, UAC on Windows). Never enter passwords: after changes
  to `src/`, run `./build.sh`, then ask the user to run `./install.sh` (macOS) or `install.ps1` (Windows) and reopen the panel.

## Seeing and proving results
- `renderFrames` results are ready when `aeb.py` returns: it waits until every PNG is complete, retries missing frames once and
  flags empty (fully transparent) and identical frames in `frameCheck` / warnings.
  Options: `resolution` 2|3|4 for cheaper frames, `isolate` to render one layer alone (both need Allow changes, restored after).
- How many frames prove a change: a static change (position, colour, text) = 1 frame after it; a direction of movement = 2+;
  easing / timing = 6-8 frames over the range (`aeb.py review`). Never judge motion from one frame.
- `python3 aeb.py review --comp C --range A B` renders N frames and makes one contact sheet (mid grey = transparent).
- `python3 aeb.py pixdiff before.png after.png --heatmap diff.png`: what changed and where (bounding box) - use it to show an
  edit touched only the intended area.
- `python3 aeb.py render --comp C --out file.mp4 [--range A B]`: a real video render in the background with aerender from a
  copy of the saved project (After Effects stays usable; unsaved changes are not included). `render-status` / `render-cancel`.
  Ask the user before rendering video; prefer frames and contact sheets for checks.

## Text and language versions
- Before sending text work back: `textLayout` (overflow, re-wrapped lines, missing glyphs) - it is cheaper than rendering.
- Fonts can be given as "Family Style"; check a font covers the language with `checkGlyphs` before `replaceFont`.
- Language version of a scene: `duplicateComp {"deep":"text","suffix":" UA","dryRun":true}` first, then without dryRun;
  then `aeb.py textsheet export` -> translator fills `target` -> `aeb.py textsheet apply --dry-run` -> apply.
- Popups take labels: `setProperty {"path":"effects/Fill/...","value":"On Transparent"}` (AE 26+); dumps show `label`/`options`.

## Editing helpers worth knowing
- Client edits: `offsetValues` ("move it up 40 px" keeps every key and its easing), `splitLayer`, `reverseKeyframes`,
  `removeKeyframes {"keepValue":"last"}`.
- Before handing work back: `lintMotion` (and `audit`, `textLayout`).
- Verify a batch in one round trip: `batch {"diff":true,...}`.
- Music: `tools/beats.py music.wav --what all --out m.csv` -> `markersFromFile`.
- Camera: `cameraMove` (dolly / truck / pedestal / orbit / dollyZoom / handheld) on a two-node camera.

## When something does not work
- First run `python3 aeb.py doctor`: it checks the installation without the panel (Python, exchange folder, BridgeLine.jsx
  in each After Effects and its version, the "Allow Scripts to Write Files" setting, whether AE runs, whether the panel answers)
  and prints what to fix.
- If the user wants to report a problem to the BridgeLine author, run `python3 aeb.py report`. It writes an anonymized
  Markdown report (versions, doctor, recent errors with context, last log lines, last result; names, texts and paths
  replaced by placeholders; never renders or the project) to the exchange folder and prints it.
  Fill in "What happened" in plain words (what was asked, expected, what happened), show the report to the user, and let
  the user send it: the BridgeLine Telegram group https://t.me/+DyrBEadWcxllMmUy, or a GitHub issue at
  https://github.com/oleksandr-stark/BridgeLine/issues (template "Bug report").
  Use `--raw` only if the user explicitly wants real names in it.

## Rules that caught bugs before
- **Always pass `--project "<path to the .aep>"`** (or `AEB_PROJECT`) so a command cannot hit the wrong project.
  It also *addresses* the command: with several AE versions listening (release + Beta), a panel that does not have
  that project open leaves the command for the right instance. Never omit it when more than one AE is running.
- **Timeouts:** a failed send has `retry_safe`. `true` = the panel never took the command, send it again. `false` = the panel took it
  and has not answered (still running, or a dialog in AE): never resend a change blindly - `python3 aeb.py status <id>` shows
  its result once it finishes; otherwise read the state first. `python3 aeb.py status` shows what each open panel is doing
  (project, Listen, Allow changes, busy with which command for how long).
- **After every write**, verify the result by reading back. Compare ids and names of the neighbouring layers too.
  Never assume a new or copied layer is "layer 1"; find it by id.
- **Complex changes** go in several steps: first create/copy → check → then configure by name/id.
- **Group related changes** into `batch` (one undo step). Do not put `noUndo` commands (save, render, menu) inside a batch.
- **Before bulk operations** (`retimeByMap`, `replaceText`, `replaceInExpressions`, `replaceItemUsage`) run with `dryRun: true`.
- **`renderFrames` returns before the PNGs are written.** Wait or poll for the files before reading them.
- **ExtendScript = ES3** (when editing `src/`):
  - no `forEach/map/indexOf` on arrays, `trim`, `JSON`;
  - reserved words are forbidden as names: `short`, `int`, `char`, `float`, `class`, `in`...;
  - code must be ASCII only. `build.sh` checks this.
- **Output via `aeb.py`** is truncated by `--max`. For large dumps use `--max 0` and parse with python, or `out` to a file.

## Useful recipes
Full workflows are in `docs/RECIPES.md`. Short versions:
- **What the user is showing:** `activeState` (live selection) or `getNotes` (the "Send selection" / "Send note" buttons).
- **Check a transition:** `renderFrames` with `times` around the cut → contact sheet via ffmpeg `hstack/vstack`.
- **Find everything related to a control:** `whereUsed {"text":"GLOBAL_CTRL"}`.
- **See what the user changed by hand:** `snapshot` before the work, `diff` after.
- **Retime to a voiceover:**
  - if the timing was edited in an NLE with freeze frames: `tools/edit_timemap.py` → "live" holds per scene → `tools/compare_frames.py`;
  - otherwise: `audioToKeyframes` (pauses) and/or `markersFromFile` (SRT/CSV) → `retimeByMap` with `dryRun` → apply.
- **Replace placeholders with real files:** `importFile`, then `replaceItemUsage {"from":"LOGO_x","to":"logo.ai","dryRun":true}`.

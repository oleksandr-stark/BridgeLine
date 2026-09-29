# Installation

Platform: **macOS**. Windows is not supported yet.

## What you need

| | Needed for | How to check |
|---|---|---|
| Adobe After Effects | the panel. Tested on AE 2026 (26.5); some text commands need 24.3+ | — |
| Python 3 | `aeb.py`, the client the agent uses | `python3 --version` (macOS asks to install the Command Line Tools the first time) |
| An AI coding agent | talking to the bridge | e.g. [Claude Code](https://claude.com/claude-code), OpenAI Codex CLI, Gemini CLI: anything that can run terminal commands |
| ffmpeg | optional: `aeb.py compare` and the scripts in `tools/` | `ffmpeg -version` (install with `brew install ffmpeg`) |
| numpy | optional: `tools/edit_timemap.py`, `tools/compare_frames.py` | see README → Tools |
| Node.js | only if you change the panel source (`build.sh`) | `node --version` |

## 1. Get the files

```bash
git clone https://github.com/oleksandr-stark/BridgeLine.git
cd BridgeLine
```

Or download the ZIP from GitHub and unpack it anywhere.

## 2. Install the panel

The panel is one file: `BridgeLine.jsx`. It goes into the `Scripts/ScriptUI Panels` folder of After Effects.

### Option A: script

```bash
./install.sh                     # newest "Adobe After Effects 20xx" in /Applications
./install.sh beta                # After Effects (Beta)
./install.sh all                 # every After Effects found
./install.sh "/Applications/Adobe After Effects 2025"
```

It asks for your Mac password (the folder belongs to the system).

### Option B: by hand, in Terminal

```bash
sudo install -m 644 BridgeLine.jsx "/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/"
```

Change `2026` to your version. Use `install -m 644` rather than `cp`: when the file is copied from an external drive with `cp`, it can get `rwx------` permissions, and After Effects then says it cannot open the file.

### Option C: by hand, in Finder

1. In Finder open `/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/`.
2. Drag `BridgeLine.jsx` into it. Finder asks for your password.
3. Select the copied file → **File → Get Info** → **Sharing & Permissions**: "everyone" must have at least **Read only**.

## 3. Allow scripts to write files

In After Effects: **After Effects → Settings → Scripting & Expressions** → turn on
**Allow Scripts to Write Files and Access Network**.

The panel needs it to read commands and write results. It does not use the network.

## 4. Open the panel

1. **Restart After Effects** after the first install. AE looks for new panels only at launch.
2. **Window → BridgeLine.jsx**. Dock it anywhere, like any other panel.
3. Tick **Listen**. The status line should say `Listening | read-only`.

What the rest of the panel does: [PANEL.md](PANEL.md).

## 5. Connect your agent

1. Open your project in After Effects and save it (the bridge addresses commands by the project file).
2. Open a terminal in the bridge folder and start your agent there:
   ```bash
   cd BridgeLine
   claude        # or: codex, gemini, ...
   ```
   The instructions are in `AGENTS.md` (Codex and most agents read it; `CLAUDE.md` and `GEMINI.md` point to it).
   If you start the agent in another folder, tell it where the bridge folder is and to read `AGENTS.md` first
   (in Claude Code you can add the folder with `/add-dir /path/to/BridgeLine`).
3. Ask the agent to ping the bridge, or run it yourself:
   ```bash
   python3 aeb.py ping --project "/path/to/Your Project.aep"
   ```
   A working bridge answers with `"ok": true`, the AE version and the project path.

## Updating

```bash
git pull
./install.sh
```

Then close the panel and open it again from the Window menu (no AE restart needed).

## Uninstalling

Delete `BridgeLine.jsx` from `Scripts/ScriptUI Panels` and, if you like, the exchange folder `~/Documents/bridgeline/`.

## Troubleshooting

| Problem | What to check |
|---|---|
| No "BridgeLine.jsx" in the Window menu | Restart After Effects. Check that the file is in `Scripts/ScriptUI Panels` of the version you run. |
| "Could not open the file" / the panel is empty | File permissions (see Option B/C). Reinstall with `install -m 644`. |
| `ping` ends with exit code 2 / "command not picked up" | The panel is closed or **Listen** is off; the Scripting setting from step 3 is off; AE is busy (a render, a modal dialog). |
| "Project guard: command is for ... but the open project is ..." | The path in `--project` does not match the project open in AE. The project must be saved. |
| "... changes the project, but 'Allow changes' is off" | Expected: tick **Allow changes** when you agree to let the agent change the project. |
| "Writing outside allowed folders is blocked" | Output files may only go to `~/Documents/bridgeline/`, the project folder or its parent folder. |
| Two After Effects versions are open | Always pass `--project`. Each command then goes to the instance that has that project open. |

The panel log is in `~/Documents/bridgeline/log.txt` (the agent can read it with `python3 aeb.py getLog`).

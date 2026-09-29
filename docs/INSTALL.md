# Installation

Platforms: **macOS** (tested) and **Windows** (new in 1.0.3, not yet tested on a real Windows machine: please report what breaks).

## What you need

| | Needed for | macOS | Windows |
|---|---|---|---|
| Adobe After Effects | the panel. Tested on AE 2026 (26.5) and 27.0 Beta; some text commands need 24.3+ | | |
| Python 3 | `aeb.py`, the client the agent uses | `python3 --version` (macOS offers to install the Command Line Tools the first time) | [python.org](https://www.python.org/downloads/) (tick "Add python.exe to PATH") or `winget install Python.Python.3.12`; the command is `python` or `py` |
| An AI coding agent | talking to the bridge | e.g. [Claude Code](https://claude.com/claude-code), OpenAI Codex CLI, Gemini CLI: anything that can run terminal commands | same |
| Git | getting and updating the files (or download the ZIP) | `git --version` | `winget install Git.Git` |
| ffmpeg | optional: `aeb.py compare` and the scripts in `tools/` | `brew install ffmpeg` | `winget install Gyan.FFmpeg` |
| numpy | optional: `tools/edit_timemap.py`, `tools/compare_frames.py` | see README → Tools | same |
| Node.js | only if you change the panel source (`build.sh`) | `node --version` | Node.js + Git Bash or WSL |

## 1. Get the files

```bash
git clone https://github.com/oleksandr-stark/BridgeLine.git
cd BridgeLine
```

Or download the ZIP from GitHub (**Code → Download ZIP**) and unpack it anywhere.

## 2. Install the panel

The panel is one file: `BridgeLine.jsx`. It goes into the `ScriptUI Panels` folder of After Effects:

| | Folder |
|---|---|
| macOS | `/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/` |
| Windows | `C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\` |

Change `2026` to your version (`Adobe After Effects (Beta)` for the Beta).

### macOS

**Option A: script**

```bash
./install.sh                     # newest "Adobe After Effects 20xx" in /Applications
./install.sh beta                # After Effects (Beta)
./install.sh all                 # every After Effects found
./install.sh "/Applications/Adobe After Effects 2025"
```

It asks for your Mac password (the folder belongs to the system).

**Option B: by hand, in Terminal**

```bash
sudo install -m 644 BridgeLine.jsx "/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/"
```

Use `install -m 644` rather than `cp`: when the file is copied from an external drive with `cp`, it can get `rwx------` permissions, and After Effects then says it cannot open the file.

Only the panel, without cloning the repository:

```bash
curl -L -o /tmp/BridgeLine.jsx https://github.com/oleksandr-stark/BridgeLine/releases/latest/download/BridgeLine.jsx
sudo install -m 644 /tmp/BridgeLine.jsx "/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/"
```

Your AI agent still needs the repository (`aeb.py` and `AGENTS.md`), so step 1 is needed anyway to work with it.

**Option C: by hand, in Finder**

1. In Finder open `/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/`.
2. Drag `BridgeLine.jsx` into it. Finder asks for your password.
3. Select the copied file → **File → Get Info** → **Sharing & Permissions**: "everyone" must have at least **Read only**.

### Windows

**Option A: script.** In the BridgeLine folder, in PowerShell or cmd:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1              # newest "Adobe After Effects 20xx"
powershell -ExecutionPolicy Bypass -File install.ps1 beta         # After Effects (Beta)
powershell -ExecutionPolicy Bypass -File install.ps1 all          # every After Effects found
powershell -ExecutionPolicy Bypass -File install.ps1 "D:\Apps\Adobe After Effects 2026"
```

Windows asks for administrator rights (the UAC window) because the folder is inside Program Files.
The installation runs in a second window, which waits for Enter so you can read the result.

**Option B: by hand, in PowerShell.** Open PowerShell **as administrator** (right-click → Run as administrator):

```powershell
Copy-Item "C:\path\to\BridgeLine\BridgeLine.jsx" "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\"
```

Only the panel, without cloning the repository (also as administrator):

```powershell
curl.exe -L -o "$env:TEMP\BridgeLine.jsx" https://github.com/oleksandr-stark/BridgeLine/releases/latest/download/BridgeLine.jsx
Copy-Item "$env:TEMP\BridgeLine.jsx" "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\"
```

**Option C: by hand, in Explorer.** Copy `BridgeLine.jsx` into the `ScriptUI Panels` folder from the table above. Windows asks for administrator permission; click **Continue**.

## 3. Allow scripts to write files

In After Effects: **After Effects → Settings** (macOS) or **Edit → Preferences** (Windows) → **Scripting & Expressions** → turn on
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
   On Windows: `python aeb.py ping --project "C:\path\to\Your Project.aep"`.
   A working bridge answers with `"ok": true`, the AE version, the project path and `bridgeFolder`, the exchange folder.

## Where the files go

The panel and the client exchange files in a `bridgeline` folder inside your Documents folder:
- macOS: `~/Documents/bridgeline/`;
- Windows: `Documents\bridgeline`. If Windows keeps Documents in OneDrive, that is `OneDrive\Documents\bridgeline`; both sides find it.

If `ping` does not answer but the panel shows **Listening**, compare `bridgeFolder` in the panel log with the folder in the client's error message.
You can point the client to a folder with the `AEB_ROOT` environment variable.

## Updating

When a new version is out, your agent mentions it after a `ping` and the panel shows a notice (see [PANEL.md](PANEL.md)).

```bash
git pull
./install.sh                                          # macOS
powershell -ExecutionPolicy Bypass -File install.ps1  # Windows
```

Then close the panel and open it again from the Window menu (no AE restart needed).

## Uninstalling

Delete `BridgeLine.jsx` from `ScriptUI Panels` and, if you like, the exchange folder `bridgeline` in Documents.

## Troubleshooting

| Problem | What to check |
|---|---|
| No "BridgeLine.jsx" in the Window menu | Restart After Effects. Check that the file is in `ScriptUI Panels` of the version you run. |
| "Could not open the file" / the panel is empty | macOS: file permissions (see Option B/C), reinstall with `install -m 644`. |
| `install.ps1` "cannot be loaded because running scripts is disabled" | Run it exactly as shown: `powershell -ExecutionPolicy Bypass -File install.ps1`. |
| `ping` ends with exit code 2 / "command not picked up" | The panel is closed or **Listen** is off; the Scripting setting from step 3 is off; AE is busy (a render, a modal dialog); the client and the panel use different folders (see "Where the files go"). |
| "Project guard: command is for ... but the open project is ..." | The path in `--project` does not match the project open in AE. The project must be saved. |
| "... changes the project, but 'Allow changes' is off" | Expected: tick **Allow changes** when you agree to let the agent change the project. |
| "Writing outside allowed folders is blocked" | Output files may only go to the `bridgeline` exchange folder, the project folder or its parent folder. |
| Two After Effects versions are open | Always pass `--project`. Each command then goes to the instance that has that project open. |

The panel log is `log.txt` in the exchange folder (the agent can read it with `aeb.py getLog`).

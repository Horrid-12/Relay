# Relay

Relay is an automated utility to synchronize your accepted HackerRank solutions directly to a designated GitHub repository.

Built on the original idea by [Sanket Gautam](https://github.com/sanketgautam/Apparate), with native API requests, secure state management, and a clean desktop interface.

---

## Key Features

- **Three Interfaces**: Use the native desktop GUI, the browser extension, or the command-line interface (CLI). All three share one `submissions.json` state format, so they can drive the same repository.
- **Fast and Native API Auth**: Bypasses slow browser automation, parental control blocks, and Cloudflare challenges by calling the HackerRank REST API directly with your session cookie.
- **Secure State Persistence**: Tracks synchronized submissions using standard `json` stored directly in your GitHub repository, replacing insecure legacy serialization.
- **Auto-Generated README**: Rewrites your repo's `README.md` from the tracked state on every sync, with solutions grouped by language and linked to each file.
- **No Silent Data Loss**: A submission whose source HackerRank will not hand back is skipped and reported, never written as an empty placeholder. It stays unrecorded, so the next sync retries it automatically.
- **Local Processing**: All code extraction and processing occurs locally on your machine without third-party network proxies.
- **Standalone Binary**: Includes an automated build script to compile a portable Windows `.exe` application.

---

## Getting Started

```bash
git clone https://github.com/Horrid-12/Relay.git
cd Relay
pip install -r requirements.txt
```

Then pick an interface below: [Desktop GUI](#desktop-gui),
[Browser Extension](#browser-extension-firefox--chrome), or
[CLI](#command-line-interface-cli).

The browser extension needs no Python install — it is pure JavaScript.

---

## Desktop GUI

Relay includes a native desktop application with a neutral dark interface and Inter typography.

### Running from Source
```bash
python relay_gui.py
```

### Building the Standalone Executable
No binary is committed to this repository. Build your own with the automated
packaging script:
```bash
python build.py
```
This stops any running `Relay.exe`, cleans previous `build/` and `dist/`
artifacts, and produces a single-file `dist/Relay.exe` you can run directly.

---

## Browser Extension (Firefox & Chrome)

A WebExtension alongside the desktop app that reads your HackerRank session
cookie automatically (no manual copying) and pushes accepted solutions to a
GitHub repository — ideal if you use a browser more often than the desktop app.

Requires Firefox 109+ or Chrome/Edge 121+.

See [`extension/README.md`](extension/README.md) for install and usage.
The extension keeps the same `submissions.json` state format as the CLI/GUI,
so all three tools can share the same repository.

---

## Command Line Interface (CLI)

Relay can also be executed directly via terminal, or scheduled with cron on
Linux/macOS or Task Scheduler on Windows.

### Usage
```bash
python -m scripts.relay --repo <Submissions_Repo_Name> --user <HackerRank_Username> --cookie <HackerRank_Cookie> --token <GitHub_Token>
```

### Options
```
Options:
  --repo TEXT    Name of GitHub repository to store submissions
  --user TEXT    Username of your HackerRank account
  --cookie TEXT  Session Cookie (_hrank_session) of your HackerRank account
  --token TEXT   GitHub Personal Access Token with 'repo' scope
  --help         Show this message and exit.
```

---

## Repairing Existing Solution Files

Earlier versions of Relay wrote the literal text `// Could not fetch code
snippet` as if it were your code, and then recorded that submission in
`submissions.json`. Because the sync cursor is the newest tracked submission,
those placeholders were skipped forever and never retried. If your repository
already contains such files, they are repairable:

```bash
# dry run — reports what would change, writes nothing
python -m scripts.repair --repo <Submissions_Repo_Name> --user <HackerRank_Username> --cookie <HackerRank_Cookie> --token <GitHub_Token>

# then, once the report looks right
python -m scripts.repair --repo ... --user ... --cookie ... --token ... --apply
```

The tool matches each broken file back to its submission through the
`Problem Link` header inside the file, re-fetches the real source, and writes it
back to the file's existing path. It never edits `submissions.json`, and it
never claims a fix it did not make — if HackerRank no longer serves that
source, the file is reported as still broken and left alone.

Recovering an old submission depends on HackerRank still having its source
stored; some very old submissions are gone for good and must be resubmitted
from HackerRank.

---

## HackerRank Cookie Authentication

The GUI and CLI call the HackerRank REST API directly using your session cookie,
which avoids Cloudflare bot-detection challenges and parental controls that block
headless browsers. (The browser extension skips this step and reads the cookie
from the browser for you.)

To get your cookie manually:
1. Log into HackerRank in your normal browser (Edge, Chrome, or Firefox).
2. Press **F12** to open Developer Tools.
3. Go to the **Application** (Chrome/Edge) or **Storage** (Firefox) tab.
4. Expand **Cookies** on the left sidebar and select `https://www.hackerrank.com`.
5. Find the cookie named `_hrank_session`.
6. Copy its **Value** and paste it into the **Cookie** field in the GUI, or pass it to `--cookie` on the CLI.

---

## GitHub Access Token Setup

To allow Relay to create and update your solutions repository:
1. Go to **GitHub Settings** -> **Developer Settings** -> **Personal Access Tokens** -> **Tokens (classic)**.
2. Generate a new token with the `repo` scope.
3. Use this token in the GUI's **Access Token** field, or pass it to the `--token` CLI argument.

---

## Architecture Overview

- **`scripts/relay.py`**: Core orchestrator managing GitHub API operations, repository creation, commit workflows, submission state tracking (`submissions.json`), and `README.md` generation.
- **`scripts/spider.py`**: REST API automation layer that traverses HackerRank submissions, fetches JSON endpoints, and extracts actual code submissions locally.
- **`scripts/repair.py`**: Repair CLI for repositories that already contain placeholder files from the old behaviour. Dry run by default.
- **`relay_gui.py`**: Native desktop GUI built with Tkinter, featuring live log streaming and credential caching.
- **`build.py`**: Automated PyInstaller packaging pipeline.
- **`extension/`**: MV3 WebExtension (Firefox + Chrome) sharing the same `submissions.json` state format. See [`extension/README.md`](extension/README.md).
- **`extension/tools/`**: `selftest.js` (unit tests), `synctest.js` (end-to-end sync tests against a stubbed HackerRank and GitHub), and `package.ps1` (builds the `.zip`/`.xpi`).

---

## Credits and Acknowledgments

- Original concept and implementation by **[Sanket Gautam](https://github.com/sanketgautam)**: [sanketgautam/Apparate](https://github.com/sanketgautam/Apparate)
- Maintained by **[Horrid-12](https://github.com/Horrid-12/Relay)**

---

## License

This project is open-source under the MIT License.

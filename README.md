# Relay

Relay is an automated utility to synchronize your accepted HackerRank solutions directly to a designated GitHub repository.

Built on the original idea by [Sanket Gautam](https://github.com/sanketgautam/Apparate), with native API requests, secure state management, and a clean desktop interface.

---

## Key Features

- **Dual Interfaces**: Use either the native desktop GUI or the command-line interface (CLI).
- **Fast and Native API Auth**: Completely bypasses slow browser automation, parental control blocks, and Cloudflare challenges by utilizing your direct HackerRank Session Cookie.
- **Secure State Persistence**: Tracks synchronized submissions using standard `json` stored directly in your GitHub repository, replacing insecure legacy serialization.
- **Local Processing**: All code extraction and processing occurs locally on your machine without third-party network proxies.
- **Standalone Binary**: Includes an automated build script to compile a portable Windows `.exe` application.

---

## Desktop GUI

Relay includes a native desktop application with a neutral dark interface and Inter typography.

### Running from Source
```bash
python relay_gui.py
```

### Running the Standalone Executable
You can run the pre-built executable directly:
```
dist/Relay.exe
```

### Building the Executable
To rebuild the standalone Windows binary, run the automated build script:
```bash
python build.py
```
The script automatically handles packaging, cleans previous build artifacts, and outputs a lightweight `dist/Relay.exe`.

---

## Browser Extension (Firefox & Chrome)

A WebExtension alongside the desktop app that reads your HackerRank session
cookie automatically (no manual copying) and pushes accepted solutions to a
GitHub repository — ideal if you use a browser more often than the desktop app.

See [`extension/README.md`](extension/README.md) for install and usage.
The extension keeps the same `submissions.json` state format as the CLI/GUI,
so the two tools can share the same repository.

---

## Command Line Interface (CLI)

Relay can also be executed directly via terminal or scheduled via cron.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Horrid-12/Relay.git
   cd Relay
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

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

## HackerRank Cookie Authentication

To bypass aggressive bot detection (Cloudflare) and parental controls that block headless browsers, Relay uses direct HTTP REST API calls using your HackerRank session cookie.

To get your cookie:
1. Log into HackerRank in your normal browser (Edge, Chrome, or Firefox).
2. Press **F12** to open Developer Tools.
3. Go to the **Application** (Chrome/Edge) or **Storage** (Firefox) tab.
4. Expand **Cookies** on the left sidebar and select `https://www.hackerrank.com`.
5. Find the cookie named `_hrank_session`.
6. Copy its **Value** and paste it into Relay.

---

## GitHub Access Token Setup

To allow Relay to create and update your solutions repository:
1. Go to **GitHub Settings** -> **Developer Settings** -> **Personal Access Tokens** -> **Tokens (classic)**.
2. Generate a new token with the `repo` scope.
3. Use this token in the GUI or pass it to the `--token` CLI argument.

---

## Architecture Overview

- **`scripts/relay.py`**: Core orchestrator managing GitHub API operations, repository creation, commit workflows, and submission state tracking (`submissions.json`).
- **`scripts/spider.py`**: Extremely fast REST API automation layer that traverses HackerRank submissions, fetches JSON endpoints, and extracts actual code submissions locally.
- **`relay_gui.py`**: Native desktop GUI built with Tkinter, featuring live log streaming and credential caching.
- **`build.py`**: Automated PyInstaller packaging pipeline.

---

## Credits and Acknowledgments

- Original concept and implementation by **[Sanket Gautam](https://github.com/sanketgautam)**: [sanketgautam/Apparate](https://github.com/sanketgautam/Apparate)
- Maintained by **[Horrid-12](https://github.com/Horrid-12/Relay)**

---

## License

This project is open-source under the MIT License.

# Relay Browser Extension (Firefox + Chrome)

A WebExtension port of the Relay desktop app. Syncs your accepted
HackerRank submissions to a GitHub repository directly from your browser.

Instead of copying your `_hrank_session` cookie by hand, the extension reads
it automatically while you are logged in on HackerRank.

## Requirements

- Firefox **109+** or Chrome/Edge **121+** (Manifest V3)
- A GitHub Personal Access Token with the `repo` scope
- You must be logged in to HackerRank (so the extension can read the cookie)

The manifest declares both `background.scripts` (Firefox event page) and
`background.service_worker` (Chrome). Each browser uses the one it supports:
Firefox runs `background.js` as an event page, Chrome runs it as a
service worker.

## Install

### Firefox (temporary, for personal use)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Browse to `dist/relay-<version>.zip` (or the `.xpi`) — you do **not**
   have to select the source folder each time.

### Chrome / Edge

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Unzip the `.zip` into a folder, then select that folder.

> You can also skip the build script and point "Load Temporary Add-on…"
> directly at `manifest.json` inside this folder — the zip is just a
> convenient distributable copy.

## Usage

1. Log in to HackerRank in a normal tab.
2. Click the **Relay** toolbar icon.
3. Paste your GitHub token and desired repository name.
4. Leave the session cookie field empty to auto-read it, then click **Sync Submissions**.

The extension will:

- Paginate your HackerRank submissions via the REST API,
- extract the accepted solutions from each submission page,
- create the repository if needed and commit each solution under `submissions/`,
- keep `submissions.json` in the repository as the sync state
  (same format the desktop app uses, so the two can share a repo).

## Notes

- Sync only runs while the browser is open (that is the nature of an extension).
- The GitHub token is kept in `chrome.storage.local`. It is scoped to
  `api.github.com` and cannot read data from other sites.
- The cookie override field is useful when your browser is open but you want
  to use a cookie from another device/session.

## Package

Run `tools/package.ps1` to produce ready-to-load archives in `dist/`:

- `relay-<version>.zip` — Chrome/Edge (unzip, then **Load unpacked**) and Firefox (**Load Temporary Add-on…**)
- `relay-<version>.xpi` — Firefox alias of the same zip

## Layout

```
manifest.json        MV3 manifest (Firefox + Chrome compatible)
background.js        sync engine: HackerRank spider + GitHub push
popup/               toolbar popup UI
icons/               generated toolbar icons
tools/gen_icons.py   toolbar icon generator
tools/package.ps1    packaging script -> dist/relay-<version>.zip/.xpi
tools/selftest.js    headless logic self-test (node tools/selftest.js)
```
# Relay Changelog

All notable changes to Relay.

---

## 1.0.0 - 1 October 2026

First stable release. The desktop app and browser extension are now both
versioned at 1.0.0. Previously they reported v0.2 and v0.4.0, which made bug
reports ambiguous.

This release is mainly about fixing silent data loss in the generated
solutions repository.

### Added

- **Automatic repository index.** The `README.md` in your synced repository is
  now rebuilt on every single sync, including syncs that find nothing new. It
  groups your solutions by language, sorts them, and links each one to both
  the source file and the original HackerRank problem. The file is completely
  overwritten each time, so treat it as generated output and do not hand-edit
  it. Works identically in the desktop app, the CLI, and the extension.

- **Repair tool.** New `scripts/repair.py` fixes solutions that older versions
  saved as empty placeholders. It matches each broken file back to its
  submission, fetches the real code, and writes it back to the same file. It
  runs as a preview by default, never changes `submissions.json`, and never
  claims to have fixed something it did not.

- **Automated sync tests.** New end-to-end test suite that runs the whole sync
  against a simulated HackerRank and GitHub, covering the cases that are hard
  to reproduce by hand.

### Fixed

- **Solutions were being saved as placeholders and then lost permanently.**
  This was the most serious bug in the project. When HackerRank would not
  return the code for a submission, Relay saved the literal text
  `// Could not fetch code snippet` as though it were your solution, and then
  marked that submission as synced. Because Relay tracks its progress using
  the most recent synced submission, anything recorded was never checked
  again, so a single later success could permanently bury older failures. In
  one real repository this had quietly affected 20 of 43 solution files. Now,
  when the code cannot be retrieved, nothing is written and nothing is marked
  as synced, so the problem is simply retried on your next sync.

- **Extension could display the wrong version number.** The version badge in
  the popup was a hardcoded value that had already drifted out of date. It now
  reads the real version from the extension manifest.

- **Build output was not excluded from git.** A locally built `Relay.exe`
  (about 27 MB) showed up as an untracked file and was one `git add` away from
  being committed by accident.

- **Two incorrect notes in the Bug Tracker**, now corrected. The old Windows
  filename bug turned out not to be real: GitHub rewrites awkward characters in
  file paths automatically, so the synced repository is fine to clone on
  Windows. This is worth knowing because it is a trap for any tool that writes
  back to an existing file: the name computed from the problem title is not
  the name on disk.

### Known limitation

A submission that cannot be retrieved *and* is older than your most recent
successful sync cannot be retried by syncing alone, because the sync position
is a single marker rather than a list of pending items. Fixing this properly
needs a change to the shared state format used by all three interfaces, which
is out of scope for 1.0.0. If you hit it, the repair tool fetches by
submission ID and is not affected.

### Verified before release

- 27 logic tests and 26 end-to-end sync tests, all passing.
- The built `Relay.exe` was launched and confirmed to report version 1.0.0.
- The packaged extension was confirmed to contain the fix.

---

## 0.4.0 - 28 September 2026

- Rebranded the project to Relay.
- Fixed C++ solutions not syncing, duplicate commits, and a 404 error.
- Added cookie-based login.
- Made the HackerRank API handling resilient to unexpected response changes.
- Added the browser extension for Firefox and Chrome.

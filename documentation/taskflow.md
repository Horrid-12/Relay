# Relay Taskflow

## Active Workflow
Currently working on resolving invalid file path issues that prevent Windows users from cloning the repository.

---

## Completed Changes

### Extension Network & Fetch Changes
- **Service Worker Cookie Fix:** Added `credentials: "include"` to all `fetch()` calls in `background.js`. In Manifest V3, manually setting the `Cookie` header is forbidden and gets silently stripped, causing the code extraction to fail.
- **REST API Fallback:** Completely rewrote `fetchCode` to prioritize the HackerRank REST API (`/rest/contests/master/submissions/{id}`) which cleanly returns the code as JSON, avoiding fragile HTML regex parsing.
- **Inline Code Capture:** Updated `fetchSubmissions` to capture code directly from the submissions list API if `m.code` or `m.compilable_code` is present, avoiding unnecessary secondary network requests.

### Core Bug Fixes (Python & Extension)
- **Submission Deduplication:** Added logic to keep only the newest submission per `(title, language)` pair. This fixed the bug where running the sync caused a flood of duplicate commits for already solved problems.
- **C++ and PyPy Detection:** Fixed the language matching logic. HackerRank uses `"cpp"` and `"pypy3"`, but the script was checking for `"c++"` and `"python"`. C++ and PyPy files now get the correct `.cpp` and `.py` extensions and comment wrappers.
- **Code Heuristic Broadening:** Expanded the `findCode` regex/heuristic to detect `#include`, `using namespace`, `def `, and `import ` patterns to reliably locate the code snippet inside the JSON payload.
- **State Saving Reliability:** Fixed a URL encoding bug in the extension's `saveState` where `contents/submissions.json` was being encoded to `contents%2Fsubmissions.json`, resulting in a GitHub API 404 error.

### Repository Maintenance
- **History Cleanup:** Squashed ~100 flooded duplicate commits down to a single clean commit using the GitHub API.
- **Heatmap Ghost Commit Fix:** Deleted and fully recreated the `HackerRank-Solutions` repository with the original README to purge orphaned commits that were lingering in GitHub's contribution heatmap cache.

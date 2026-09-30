# Relay Bug Tracker

## Open Bugs

### 1. Windows File Path Sanitization
- **Severity**: High (breaks repository cloning on Windows)
- **Description**: HackerRank challenge titles sometimes include colons (e.g., `Python: Division`). The Relay tool uses the challenge title as the file name (`Python: Division.py`). While GitHub accepts colons in file paths via the API, the Windows file system strictly forbids them. 
- **Impact**: Any Windows user attempting to run `git clone` or `git pull` on the synced repository will encounter an `invalid path` error and the checkout will fail entirely.
- **Required Fix**: Update `filePathFor` in `background.js` and the file naming logic in `relay.py` to strip or replace colons (`:`) and other invalid Windows filename characters (`<`, `>`, `"`, `/`, `\`, `|`, `?`, `*`) with safe alternatives (like dashes or spaces).
- **Update**: The premise is wrong. GitHub normalises the path server-side, so the synced repository never contains an illegal character. Verified on `Horrid-12/HackerRank-Solutions`: the submission for `Python: Division` is stored as `Python Division.py`, `Say "Hello, World!" With Python` as `Say Hello World With Python.py`, and `Find the Runner-Up Score!` as `Find the Runner-Up Score.py`. Colon, quote, question mark, exclamation mark and slashes are simply dropped. A Windows `git clone` of the repo succeeds.
- **Consequence for tooling**: The local name computed from the title is *not* the name on disk, so anything writing back to an existing solution must use the `path` GitHub reports for the file rather than recomputing it. `scripts/repair.py` was written the naive way first and would have created duplicate files (`Python: Division.py` alongside `Python Division.py`); it now writes to `item.path`.

### 2. GUI Crashes on Startup When `browser_login` Was Saved
- **Severity**: High (GUI unusable, no user-visible error)
- **Description**: `_toggle_browser_login()` in `relay_gui.py:280-288` references `self.entry_pass` and `self.opt_browser`, neither of which is ever created. Only `entry_user`, `entry_cookie`, `entry_token`, and `entry_repo` are built (lines 113-125). `_load_saved_config()` calls `_toggle_browser_login()` at line 246 whenever a saved config has `browser_login: true`.
- **Impact**: `self.entry_pass` raises `AttributeError`. The surrounding `except Exception: pass` at line 249 swallows it silently, so the GUI appears to launch with no error — but the saved username is left half-loaded and the `browser_choice` restore on line 248 never runs. Any config that once had browser login enabled stays broken across restarts.
- **Required Fix**: Either remove the dead browser-login code path (it is vestigial from the pre-REST automation era) or re-create the missing widgets. Note that `Spider.__init__` accepts `browser_login`/`browser_name` but never uses them (`spider.py:14`), and `relay.py` never reads the `browser_login_mode` / `browser_name_choice` globals that `relay_gui.py:334-335` sets, so the feature is non-functional end to end. Removing it is the honest fix. Also stop swallowing exceptions in `_load_saved_config` — log them instead.

### 3. README Advertises a Binary That Is Not Shipped
- **Severity**: Medium (broken first-run instructions)
- **Description**: The README previously told users to run the pre-built `dist/Relay.exe` directly. `dist/` and `build/` are both gitignored, so no executable exists in a fresh clone.
- **Impact**: First-time users following the GUI section hit a missing-file error with no indication that they need to run `python build.py` first.
- **Required Fix**: ✅ Fixed — the section now says no binary is committed and directs users to `python build.py`.
- **Correction**: the claim that `dist/` is gitignored was wrong. `.gitignore` covered `build/` and `extension/dist/` but not the root `dist/`, so a locally built 27 MB `dist/Relay.exe` showed up as untracked and was one `git add .` away from being committed. Found while producing the 1.0.0 build; `dist/` is now ignored.

### 4. Version Numbers Are Inconsistent Across Interfaces
- **Severity**: Low (cosmetic, but confusing for bug reports)
- **Description**: The desktop GUI reported `v0.2` (`relay_gui.py:64` and `:100`), while the browser extension was at `0.4.0` (`extension/manifest.json:4`). There was no shared version constant and no CHANGELOG to explain the divergence.
- **Impact**: Users and maintainers cannot tell which build is current, and bug reports citing a version are ambiguous.
- **Required Fix**: ✅ Done at the 1.0.0 release. Unified on a single scheme: `relay_gui.py` now has one `VERSION` constant driving both the window title and the header label (so the two cannot drift), and `extension/manifest.json` carries the same `1.0.0`. `extension/tools/package.ps1` reads the version from the manifest, so the package filename follows automatically. The two files still have to be bumped together, but the GUI's internal duplication is gone.

### 5. A Failure Older Than the Newest Commit Is Never Retried
- **Severity**: Medium (silent, one-off data loss)
- **Description**: `submissions.json` is a single newest-first list and both sync engines treat `state[0]` as the cursor: pagination halts the moment that link is reached. A submission whose source could not be fetched is now correctly left out of the index, so it stays *ahead* of the cursor and is retried — but only while newer submissions keep succeeding. If a newer submission commits successfully first, the cursor moves above the failure and the older failure becomes unreachable by any future sync.
- **Impact**: For a batch like `[C ok, B fails, A ok]`, `B` is lost. `A` is still saved, because the code commits every retrievable submission rather than stopping at the first failure — stopping there would strand `A` as well and lose strictly more.
- **Required Fix**: Needs a real change to the state format, e.g. a separate `pending` list of unretrievable submissions that sync drains independently of the main cursor. That alters the format shared by the CLI, GUI and extension, so it is deliberately out of scope for 1.0.0. Pinned by `extension/tools/synctest.js` scenario 4 and the matching Python case so the current trade-off is deliberate rather than accidental.
- **Workaround**: `python -m scripts.repair --apply` re-fetches by submission id and is not subject to the cursor at all.

## Closed Bugs
- ✅ **Solution files committed as `// Could not fetch code snippet`**, which then became permanent
  - **Root cause**: two defects compounding. `spider.py` wrote that string as if it were source when HackerRank would not return a submission's code; the extension behaved the same way. Worse, the placeholder was *committed* and *recorded in `submissions.json`*. The sync cursor is the first entry of that file, so every recorded submission — placeholder or not — was treated as already synced and skipped forever. Because the index holds the newest submission first, a single successful fetch moved the cursor above every older failure and stranded them permanently. In `Horrid-12/HackerRank-Solutions`, 20 of 43 files are placeholders: a contiguous block of 19 from one old run plus one isolated straggler.
  - **Fix**: a failed fetch now yields no file and no index entry (`scripts/spider.py`; `extension/background.js` `fetchCode()` returns `null`). The index only ever holds genuinely retrieved submissions, so the cursor never advances past a failure and the next sync retries it automatically. Verified end to end in `extension/tools/synctest.js` (scenarios 2-3: a skipped submission stays ahead of the cursor and is written on the following run).
  - **Recovery**: `scripts/repair.py` re-fetches the real source for the already-broken files and writes it back in place. It never modifies `submissions.json`, so a repair cannot itself mask a failure.
- ✅ Submissions.json 404 Error (URL encoding fixed)
- ✅ Code missing for C++ and PyPy (Language mapping fixed)
- ✅ Code extraction failing on extension (Fixed via REST API fallback & `credentials: include`)
- ✅ Commit flood from overwriting existing solutions (Fixed via deduplication logic)
- ✅ README claimed a pre-built `dist/Relay.exe` that is not in the repo (README now points to `python build.py`)

# Relay Bug Tracker

## Open Bugs

### 1. Windows File Path Sanitization
- **Severity**: High (breaks repository cloning on Windows)
- **Description**: HackerRank challenge titles sometimes include colons (e.g., `Python: Division`). The Relay tool uses the challenge title as the file name (`Python: Division.py`). While GitHub accepts colons in file paths via the API, the Windows file system strictly forbids them. 
- **Impact**: Any Windows user attempting to run `git clone` or `git pull` on the synced repository will encounter an `invalid path` error and the checkout will fail entirely.
- **Required Fix**: Update `filePathFor` in `background.js` and the file naming logic in `relay.py` to strip or replace colons (`:`) and other invalid Windows filename characters (`<`, `>`, `"`, `/`, `\`, `|`, `?`, `*`) with safe alternatives (like dashes or spaces).

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

### 4. Version Numbers Are Inconsistent Across Interfaces
- **Severity**: Low (cosmetic, but confusing for bug reports)
- **Description**: The desktop GUI reports `v0.2` (`relay_gui.py:64` and `:100`), while the browser extension is at `0.4.0` (`extension/manifest.json:4`). There is no shared version constant and no CHANGELOG to explain the divergence.
- **Impact**: Users and maintainers cannot tell which build is current, and bug reports citing a version are ambiguous.
- **Required Fix**: Pick a scheme. Either unify on a single version across GUI and extension, or keep them independent and label them separately (e.g. `Relay Desktop v0.2` / `Relay Extension v0.4.0`) so the distinction is explicit.

## Closed Bugs
- ✅ Submissions.json 404 Error (URL encoding fixed)
- ✅ Code missing for C++ and PyPy (Language mapping fixed)
- ✅ Code extraction failing on extension (Fixed via REST API fallback & `credentials: include`)
- ✅ Commit flood from overwriting existing solutions (Fixed via deduplication logic)
- ✅ README claimed a pre-built `dist/Relay.exe` that is not in the repo (README now points to `python build.py`)

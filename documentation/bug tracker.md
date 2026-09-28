# Relay Bug Tracker

## Open Bugs

### 1. Windows File Path Sanitization
- **Severity**: High (breaks repository cloning on Windows)
- **Description**: HackerRank challenge titles sometimes include colons (e.g., `Python: Division`). The Relay tool uses the challenge title as the file name (`Python: Division.py`). While GitHub accepts colons in file paths via the API, the Windows file system strictly forbids them. 
- **Impact**: Any Windows user attempting to run `git clone` or `git pull` on the synced repository will encounter an `invalid path` error and the checkout will fail entirely.
- **Required Fix**: Update `filePathFor` in `background.js` and the file naming logic in `relay.py` to strip or replace colons (`:`) and other invalid Windows filename characters (`<`, `>`, `"`, `/`, `\`, `|`, `?`, `*`) with safe alternatives (like dashes or spaces).

## Closed Bugs
- ✅ Submissions.json 404 Error (URL encoding fixed)
- ✅ Code missing for C++ and PyPy (Language mapping fixed)
- ✅ Code extraction failing on extension (Fixed via REST API fallback & `credentials: include`)
- ✅ Commit flood from overwriting existing solutions (Fixed via deduplication logic)

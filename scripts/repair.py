"""
Repair tool for placeholder submissions.

Early versions of Relay wrote the literal string "// Could not fetch code
snippet" into the repository whenever HackerRank would not hand back the
source for a submission. Because those submissions were then recorded in
submissions.json, the sync cursor moved past them and they were never
retried — so the placeholders became permanent.

Relay no longer writes placeholders (see scripts/spider.py), but repos that
were synced with the old behaviour still contain them. This tool walks the
state file, finds every submission whose file is a placeholder, and tries to
replace it with the real source.

Nothing is recorded as repaired that was not actually fixed: submissions.json
is left completely untouched. A submission is only fixed if HackerRank still
serves its source.

Usage:
    python -m scripts.repair --repo REPO --user USER --cookie COOKIE --token TOKEN
    python -m scripts.repair ... --apply        # actually write the fixes
    python -m scripts.repair ... --retries 5   # more attempts per submission

Dry-run is the default so you can see what would change before it touches the
repo. Your session cookie stays on your machine; nothing is uploaded anywhere.
"""

from github import Github, GithubException
from scripts.config import logger
from scripts.spider import Spider
from scripts.relay import build_submission_content, sanitize_file_name, resolve_language
import json
import re
import sys
import time
import click

# The exact sentinel the old code committed as if it were source code.
PLACEHOLDER = "// Could not fetch code snippet"

# A file whose body is shorter than this has no real solution in it, whatever
# it is called. Guards against placeholders that predate the exact string.
# The shortest genuine solution observed in the wild is ~55 bytes.
MIN_PLAUSIBLE_CODE = 20


def solution_file_name(title, language):
    return sanitize_file_name(title) + resolve_language(language)[1]


def split_body(text):
    """Return the part of a solution file after its header block.

    Python headers are wrapped in ''' ... ''' and C-style ones in /* ... */,
    so the closer has to be found per flavour — splitting on the first
    occurrence of either delimiter returns the header itself for Python.
    """
    stripped = text.lstrip()
    if stripped.startswith("'''"):
        parts = text.split("'''", 2)
        return parts[2] if len(parts) > 2 else ""
    if stripped.startswith("/*"):
        return text.split("*/", 1)[1] if "*/" in text else ""
    return text


def parse_header(text):
    def field(name):
        m = re.search(rf"^{name}:\s*(.+)$", text, re.MULTILINE)
        return m.group(1).strip() if m else None

    return {
        "title": field("Problem Title"),
        "language": field("Language"),
        "problem": field("Problem Link"),
        "author": field("Author"),
    }


def is_placeholder(text):
    if PLACEHOLDER in text:
        return True
    return len(split_body(text).strip()) < MIN_PLAUSIBLE_CODE


def load_state(repo):
    try:
        c = repo.get_contents("submissions.json")
        return json.loads(c.decoded_content.decode("utf-8"))
    except GithubException as e:
        if getattr(e, "status", None) == 404:
            return None
        raise


def survey(repo, state):
    """Return [(entry, item, reason)] for every broken submission.

    Files are matched to entries by the Problem Link header inside the file,
    never by filename: GitHub rewrites characters that are awkward in URLs, so
    'Python: Division' is stored on disk as 'Python Division.py' and a
    name-based join silently misses those submissions.
    """
    contents = repo.get_contents("submissions/")
    by_path = {}
    for item in contents:
        if item.type == "file":
            by_path[item.name] = item

    by_problem = {}
    for entry in state:
        if len(entry) >= 3:
            by_problem.setdefault(entry[2], entry)

    broken = []
    for name, item in by_path.items():
        text = item.decoded_content.decode("utf-8", errors="ignore")
        if not is_placeholder(text):
            continue
        problem = parse_header(text)["problem"]
        entry = by_problem.get(problem)
        reason = "placeholder text" if PLACEHOLDER in text else "no source in file"
        if entry is None:
            broken.append((None, item, f"{reason} (no state entry for {problem})"))
        else:
            broken.append((entry, item, reason))

    return broken


@click.command()
@click.option("--repo", prompt=True, help="Name of the GitHub submissions repository")
@click.option("--user", prompt=True, help="Your HackerRank username")
@click.option("--cookie", prompt=True, hide_input=True, help="HackerRank _hrank_session cookie")
@click.option("--token", prompt=True, help="GitHub Personal Access Token with 'repo' scope")
@click.option("--apply", "apply_changes", is_flag=True, default=False,
              help="Write the repairs to GitHub (default is a dry run)")
@click.option("--retries", default=3, show_default=True, help="Fetch attempts per broken submission")
def repair(repo, user, cookie, token, apply_changes, retries):
    """Find and repair submissions that were committed as placeholders."""
    try:
        g = Github(token, timeout=30, retry=3, user_agent="Relay-Repair")
        target = g.get_user().get_repo(repo)
    except Exception as e:
        print(f"[Error] GitHub authentication/lookup failed: {e}")
        sys.exit(1)

    state = load_state(target)
    if state is None:
        print("[Error] No submissions.json in that repository — nothing to repair.")
        sys.exit(1)

    print(f"Repository '{repo}' has {len(state)} submission(s) recorded.")

    broken = survey(target, state)
    if not broken:
        print("\nNothing to repair — every submission file contains real source.")
        return

    print(f"\nFound {len(broken)} broken submission file(s):")
    for entry, item, reason in broken:
        label = entry[0] if entry else (item.name if item else "?")
        where = item.name if item else "(missing)"
        print(f"  - {label}  [{where}]  -- {reason}")

    mode = "REPAIR" if apply_changes else "DRY RUN (pass --apply to write)"
    print(f"\n--- {mode} ---")

    spider = Spider(user, cookie)
    fixed, still_broken = [], []

    for entry, item, reason in broken:
        if entry is None:
            still_broken.append((entry, item, reason, "no state entry to re-fetch from"))
            continue

        title, language, problem, status, link = entry[:5]
        submission = (title, language, problem, status, link)

        code = None
        for attempt in range(1, retries + 1):
            codes = spider.fetch_code_for_submissions([submission])
            code = codes.get(submission)
            if code:
                break
            if attempt < retries:
                print(f"  retry {attempt}/{retries - 1} for '{title}'…")
                time.sleep(2)

        if not code:
            still_broken.append((entry, item, reason, "HackerRank did not return the source"))
            print(f"  UNFIXED  {title}: HackerRank did not return the source.")
            continue

        content = build_submission_content(title, language, problem, g.get_user().login, code)

        if item is not None:
            # Always write back to the path the file already occupies. GitHub
            # rewrites characters like ':' '"' '?' and '!' in submitted paths,
            # so a name recomputed from the title does not match what is
            # actually in the repo and would create a duplicate file.
            path = item.path
        else:
            path = "submissions/" + solution_file_name(title, language)

        if apply_changes:
            try:
                if item is not None:
                    target.update_file(path, f"repaired {path.split('/')[-1]}",
                                      content, item.sha)
                else:
                    target.create_file(path, f"repaired {path.split('/')[-1]}", content)
                    print(f"   note: created {path} (GitHub may rename characters like : ? ! in the title)")
            except GithubException as e:
                still_broken.append((entry, item, reason, f"GitHub write failed: {e}"))
                print(f"  ERROR    {title}: {e}")
                continue

        fixed.append(title)
        print(f"  {'FIXED' if apply_changes else 'WOULD FIX'}  {title}  "
              f"({len(code)} chars) -> {path}")

    spider.quit_driver()

    print(f"\n{len(fixed)} repaired, {len(still_broken)} still broken.")
    if still_broken:
        print("\nStill broken (HackerRank may no longer serve this source):")
        for entry, item, reason, why in still_broken:
            label = entry[0] if entry else (item.name if item else "?")
            print(f"  - {label}: {why}")
        print("\nThese submissions stay in submissions.json. To make Relay retry them, "
              "delete their entries from submissions.json (the file is JSON — one list per "
              "submission) and sync again; the next sync will re-fetch from the cursor.")
    if not apply_changes and fixed:
        print("\nThis was a dry run. Re-run with --apply to write these repairs.")


if __name__ == "__main__":
    repair()

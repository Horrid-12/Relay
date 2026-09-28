from scripts.spider import Spider
import json
import pickle
from github import Github, GithubException
from datetime import datetime
from scripts.config import logger
import click
import sys


class Apparate:

    def __init__(self):
        self.submissions = []
        self.repo = None

        # ── GitHub Authentication ─────────────────────────────────────────
        try:
            token = github_token.strip()
            try:
                from github import Auth
                auth = Auth.Token(token)
                g = Github(auth=auth, timeout=30, retry=3, user_agent="Apparate-Sync")
            except Exception:
                g = Github(token, timeout=30, retry=3, user_agent="Apparate-Sync")

            user = g.get_user()
            login_name = user.login
            print(f"GitHub Authentication Successful (User: @{login_name})")
            logger.info(f"GitHub Authentication Successful (User: @{login_name})")
        except Exception as e:
            status = getattr(e, 'status', getattr(e, '_GithubException__status', None))
            if status == 401 or "401" in str(e) or "Bad credentials" in str(e):
                print("Unable to authenticate to GitHub: Invalid Personal Access Token.")
                print("Tip: Click 'Get Token in Browser' to generate a valid token with 'repo' scope.")
                logger.info("Unable to authenticate to GitHub, invalid token.")
            elif "503" in str(e) or "504" in str(e) or "Max retries exceeded" in str(e):
                print("GitHub API temporary connection issue (503/504). Please try again in a few seconds.")
            else:
                print(f"GitHub Authentication Error: {e}")
                logger.exception(e)
            raise SystemExit(1)

        # ── Verify / Create GitHub Repository ────────────────────────────
        try:
            self.repo = user.get_repo(submissions_repo)
            logger.info(f"Submissions repo '{submissions_repo}' found.")
            print(f"Submissions repo '{submissions_repo}' found.")
        except Exception as e:
            status = getattr(e, 'status', getattr(e, '_GithubException__status', None))
            if status == 404 or "404" in str(e) or "Not Found" in str(e):
                logger.info(f"Submissions repo '{submissions_repo}' not found. Creating new repository…")
                print(f"Repository '{submissions_repo}' not found — creating new repository on GitHub…")
                self.repo = user.create_repo(
                    name=submissions_repo,
                    private=False,
                    description="Collection of Solutions to various HackerRank Problems"
                )
                self.repo.create_file("README.md", "initial commit", "# " + submissions_repo)
                logger.info("Repo & README.md created successfully")
                print("Repo & README.md created successfully")
            else:
                logger.exception(e)
                print("GitHub Repository Error: ", e)
                raise

        # ── Load / Initialize Submissions Tracking State ──────────────────
        try:
            c = self.repo.get_contents("submissions.json")
            self.submissions = json.loads(c.decoded_content.decode('utf-8'))
            logger.info(f"Loaded submissions.json with {len(self.submissions)} recorded entries.")
            print(f"Loaded existing index ({len(self.submissions)} previous submissions synced).")
        except Exception as e:
            status = getattr(e, 'status', getattr(e, '_GithubException__status', None))
            if status == 404 or "404" in str(e) or "Not Found" in str(e):
                # Check for legacy submissions.txt (pickle) for migration
                try:
                    c_old = self.repo.get_contents("submissions.txt")
                    self.submissions = pickle.loads(c_old.decoded_content)
                    self.repo.create_file("submissions.json", "migrated submissions.txt to json", json.dumps(self.submissions))
                    logger.info("submissions.txt migrated to submissions.json successfully")
                    print("Migrated old submissions.txt to submissions.json successfully.")
                except Exception as e_inner:
                    status_inner = getattr(e_inner, 'status', getattr(e_inner, '_GithubException__status', None))
                    if status_inner == 404 or "404" in str(e_inner) or "Not Found" in str(e_inner):
                        logger.info("Initializing new submissions.json")
                        print("Initializing new submissions tracking file in repository…")
                        self.repo.create_file("submissions.json", "created submissions.json", json.dumps(self.submissions))
                    else:
                        logger.exception(e_inner)
                        print("Exception loading state: ", e_inner)
            else:
                logger.exception(e)
                print("Exception loading state: ", e)

    def check_updates(self):
        spider = Spider(hackerrank_username, hackerrank_cookie)

        if len(self.submissions) > 0:
            last_saved = self.submissions[0][4]  # get all submissions after last_saved
        else:
            last_saved = -1  # get all submissions

        spider.fetch_new_submissions(last_saved)
        new_submissions = spider.submissions

        # Deduplicate: keep only the latest submission per (title, language).
        # Submissions arrive newest-first, so the first occurrence wins.
        seen = set()
        unique_submissions = []
        for sub in new_submissions:
            key = (sub[0], sub[1])  # (title, language)
            if key not in seen:
                seen.add(key)
                unique_submissions.append(sub)
            else:
                logger.info(f"Skipping duplicate submission for '{sub[0]}' ({sub[1]})")
        
        if len(new_submissions) != len(unique_submissions):
            print(f"Deduplicated: {len(new_submissions)} submissions → {len(unique_submissions)} unique problems.")
        new_submissions = unique_submissions

        if len(new_submissions) == 0:
            spider.quit_driver()
            return None, None

        logger.info(f"{len(new_submissions)} new submission(s) found.")
        logger.debug("Fetching code for new submissions…")
        print(f"Fetching source code for {len(new_submissions)} submission(s)...")

        codes = spider.fetch_code_for_submissions(new_submissions)
        spider.quit_driver()
        return new_submissions, codes

    def create_commit(self, submission, code):
        title = submission[0]
        language = submission[1]
        link = submission[2]

        file_directory = "submissions/"
        file_name = title.replace("/", "_").replace("\\", "_")
        file_extension = ""

        lang = language.lower()
        if "c++" in lang or lang.startswith("cpp"):
            file_extension = ".cpp"
        elif "java" in lang:
            file_extension = ".java"
        elif "python" in lang or lang.startswith("pypy"):
            file_extension = ".py"

        if file_extension != ".py":
            content = "/*-----------------------------------------------------------------------\n"
        else:
            content = "'''-----------------------------------------------------------------------\n"

        author = hackerrank_username or "HackerRank User"
        content += f"\nProblem Title: {title}"
        content += f"\nProblem Link: {link}"
        content += f"\nAuthor: {author}"
        content += f"\nLanguage: {language}"

        if file_extension != ".py":
            content += "\n\n-----------------------------------------------------------------------*/\n\n"
        else:
            content += "\n\n-----------------------------------------------------------------------'''\n\n"

        content += "\n" + code

        file_path = file_directory + file_name + file_extension

        try:
            message = "updated " + file_name
            c = self.repo.get_contents(file_path)
            if c.decoded_content.decode('utf-8', errors='ignore') != content:
                self.repo.update_file(file_path, message, content, c.sha)
                logger.info("  -- updated existing file")
                print("  -- updated existing file")
        except Exception as e:
            status = getattr(e, 'status', getattr(e, '_GithubException__status', None))
            if status == 404 or "404" in str(e) or "Not Found" in str(e):
                message = "added " + file_name
                self.repo.create_file(file_path, message, content)
                logger.info("  -- created new file")
                print("  -- created new file")
            else:
                logger.exception(e)
                print("Exception: ", e)

        return file_path

    def update_repo(self, submissions, codes):
        logger.debug(f"Updating repo for {len(submissions)} new submission(s)…")
        print(f"Updating repo for {len(submissions)} new submission(s)…")
        i = 1
        for submission in submissions:
            logger.info(f" - updating repo with submission {i}")
            print(f" - updating repo with submission {i}. {submission[0]}")
            self.create_commit(submission, codes[submission])
            i += 1

    def update_submissions(self, submissions):
        new_content = json.dumps(submissions + self.submissions)
        max_retries = 3
        
        for attempt in range(1, max_retries + 1):
            try:
                # Always re-fetch to get the latest SHA (avoids stale SHA after
                # the many commits that update_repo() has just pushed).
                c = self.repo.get_contents("submissions.json")
                self.repo.update_file(
                    "submissions.json",
                    "updated submissions.json",
                    new_content,
                    c.sha
                )
                logger.info("submissions.json updated successfully")
                print("submissions.json index updated successfully")
                return
            except GithubException as e:
                status = getattr(e, 'status', None)
                if status == 404:
                    # File doesn't exist yet — create it
                    try:
                        self.repo.create_file(
                            "submissions.json",
                            "created submissions.json",
                            new_content
                        )
                        logger.info("submissions.json created successfully")
                        print("submissions.json index created successfully")
                        return
                    except Exception as create_e:
                        logger.exception(create_e)
                        print(f"[Error] Could not create submissions.json: {create_e}")
                        return
                elif status == 409 and attempt < max_retries:
                    # Conflict — SHA is stale; retry with a fresh fetch
                    logger.warning(f"SHA conflict on attempt {attempt}, retrying…")
                    import time
                    time.sleep(1)
                    continue
                else:
                    logger.exception(e)
                    print(f"[Error] Could not update submissions.json ({status}): {e}")
                    return
            except Exception as e:
                logger.exception(e)
                print(f"[Error] Could not update submissions.json: {e}")
                return


@click.command()
@click.option("--repo", prompt=True, help="Name of GitHub repository to store submissions")
@click.option("--user", prompt=True, help="Username of your HackerRank account")
@click.option("--cookie", prompt=True, hide_input=True, help="Session Cookie (_hrank_session) of your HackerRank account")
@click.option("--token", prompt=True, help="GitHub Personal Access Token with 'repo' scope")
def apparate(repo, user, cookie, token):
    """ Tool to Synchronize HackerRank Submissions with GitHub """
    global submissions_repo, hackerrank_username, hackerrank_cookie, github_token
    submissions_repo = repo
    hackerrank_username = user
    hackerrank_cookie = cookie
    github_token = token

    startTime = datetime.now()
    logger.debug(startTime.strftime("Executing Apparate on %a, %d %b %Y, %H:%M:%S"))
    print(startTime.strftime("Executing Apparate on %a, %d %b %Y, %H:%M:%S"))

    try:
        app = Apparate()
        new_submissions, codes = app.check_updates()

        if new_submissions is not None:
            app.update_repo(new_submissions, codes)
            app.update_submissions(new_submissions)
        else:
            logger.info("No new submissions found!")
            print("No new submissions found! Nothing to update.")

    except Exception as e:
        logger.error("[FATAL Error] Unable to Apparate")
        logger.exception(e)
        print("[FATAL Error] Unable to Apparate", e)
        exit(1)

    finally:
        diff = (datetime.now() - startTime).seconds
        minutes = diff // 60
        seconds = diff - minutes * 60
        logger.debug(f"Time taken to Apparate is {minutes} min(s), {seconds} sec(s)")
        print(f"Time taken to Apparate is {minutes} min(s), {seconds} sec(s)")


if __name__ == "__main__":
    apparate()

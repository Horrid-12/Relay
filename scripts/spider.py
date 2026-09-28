import os
import sys
import time
import re
import json
import logging
import requests
import urllib.parse
from bs4 import BeautifulSoup

logger = logging.getLogger("Relay.Spider")

class Spider:
    def __init__(self, username, cookie, browser_login=False, browser_name=None):
        self.username = username
        self.cookie = cookie
        self.submissions = []
        
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
        })
        if self.cookie:
            self.session.cookies.set("_hrank_session", self.cookie, domain=".hackerrank.com")

        print("HackerRank Session Initialized")
        logger.info("HackerRank Session Initialized")

    def fetch_new_submissions(self, last_saved=""):
        print("Fetching submissions using HackerRank REST API...")
        logger.info("Fetching submissions via REST API")
        
        # We can just paginate through the API
        page = 0
        limit = 20
        while True:
            offset = page * limit
            api_url = f"https://www.hackerrank.com/rest/contests/master/submissions/?offset={offset}&limit={limit}"
            
            try:
                resp = self.session.get(api_url)
                if not resp.ok:
                    print(f"API returned status {resp.status_code}. Your cookie might be expired or invalid.")
                    break
                    
                data = resp.json()
                models = data.get('models', [])
                if not models:
                    print("No more submissions found.")
                    break
                    
                print(f"Loaded {len(models)} submissions from offset {offset}")
                
                for m in models:
                    title = m['challenge']['name']
                    language = m['language']
                    problem = "/challenges/" + m['challenge']['slug']
                    result = m['status']
                    sub_id = m['id']
                    
                    # Ensure matching format for last_saved
                    link = f"challenges/{m['challenge']['slug']}/submissions/code/{sub_id}"
                    
                    if link == last_saved:
                        print(f"Reached previously saved submission ({title}). Stopping pagination.")
                        return
                        
                    if result != "Accepted":
                        print(f"Skipping '{title}' because result is '{result}' (not 'Accepted').")
                        continue
                        
                    print(f"Found new accepted submission: {title} ({language})")
                    self.submissions.append((title, language, problem, result, link))
                    
                page += 1
                time.sleep(1) # Be nice to HackerRank
                
            except Exception as e:
                print(f"Error fetching API: {e}")
                break

    def fetch_code_for_submissions(self, new_submissions=None):
        if new_submissions is None:
            new_submissions = self.submissions
        print("\nFetching source code for {} submissions...".format(len(new_submissions)))
        codes = {}
        for i, submission in enumerate(new_submissions, 1):
            title = submission[0]
            link = submission[4]
            print(f" - fetching code for submission {i}. {title}")
            
            full_url = link
            if not full_url.startswith("http"):
                if not full_url.startswith("/"):
                    full_url = "/" + full_url
                full_url = "https://www.hackerrank.com" + full_url
                
            code = "// Could not fetch code snippet"
            try:
                resp = self.session.get(full_url)
                if resp.ok:
                    html = resp.text
                    m = re.search(r'<script.*?id="initialData".*?>(.*?)</script>', html, re.DOTALL)
                    if m:
                        try:
                            # It's URL encoded JSON
                            raw_json = urllib.parse.unquote(m.group(1))
                            j = json.loads(raw_json)
                            
                            # Find code deep inside the json tree with stronger heuristics
                            found = False
                            def find_code(d):
                                nonlocal found, code
                                if found: return
                                if isinstance(d, dict):
                                    # Look for 'code' key
                                    if 'code' in d and isinstance(d['code'], str):
                                        c = d['code']
                                        # Heuristic: Real code is usually multi-line or contains typical programming syntax
                                        if len(c) > 5 and (
                                            any(char in c for char in "{}();=\n")
                                            or '#include' in c
                                            or 'using namespace' in c
                                            or c.strip().startswith('def ')
                                            or c.strip().startswith('import ')
                                        ):
                                            code = c
                                            found = True
                                            return
                                    # Sometimes it might be in 'source' or 'source_code'
                                    for k in ['source', 'source_code']:
                                        if k in d and isinstance(d[k], str) and len(d[k]) > 5:
                                            code = d[k]
                                            found = True
                                            return
                                    for v in d.values():
                                        find_code(v)
                                elif isinstance(d, list):
                                    for v in d:
                                        find_code(v)
                            find_code(j)
                        except Exception as parse_e:
                            logger.error(f"Failed to parse initialData: {parse_e}")
                            
                # Note: The REST API fallback (GET /submissions/id) returns 405 Method Not Allowed,
                # so we rely entirely on the initialData JSON parsing above.
                
                # REST API fallback: try fetching code directly from the submissions API
                if code == "// Could not fetch code snippet":
                    try:
                        # Extract submission ID from the link
                        sub_id_match = re.search(r'/code/(\d+)', link)
                        if sub_id_match:
                            sub_id = sub_id_match.group(1)
                            api_url = f"https://www.hackerrank.com/rest/contests/master/submissions/{sub_id}"
                            api_resp = self.session.get(api_url)
                            if api_resp.ok:
                                api_data = api_resp.json()
                                model = api_data.get('model', api_data)
                                api_code = model.get('code', model.get('source', ''))
                                if api_code and len(api_code.strip()) > 5:
                                    code = api_code
                                    logger.info(f"  Got code via REST API fallback for '{title}'")
                    except Exception as api_e:
                        logger.warning(f"REST API fallback also failed for '{title}': {api_e}")
                        
                if code == "// Could not fetch code snippet":
                    logger.warning(f"Could not extract code for '{title}' from any source")
                    
            except Exception as e:
                print(f"Error fetching {title}: {e}")
                
            codes[submission] = code
            time.sleep(1)
            
        return codes

    def quit_driver(self):
        self.session.close()

if __name__ == "__main__":
    pass

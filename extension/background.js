const api = typeof browser !== "undefined" ? browser : chrome;

const HACKERRANK_ROOT = "https://www.hackerrank.com";
const GITHUB_ROOT = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hrHeaders(cookie) {
  return {
    Cookie: `_hrank_session=${cookie}`,
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9"
  };
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "Relay-Extension"
  };
}

async function getSessionCookie() {
  const c = await api.cookies.get({ url: `${HACKERRANK_ROOT}/`, name: "_hrank_session" });
  return c ? c.value : "";
}

async function fetchSubmissions(cookie, lastSaved, log) {
  const found = [];
  let page = 0;
  const limit = 20;

  for (;;) {
    const url = `${HACKERRANK_ROOT}/rest/contests/master/submissions/?offset=${page * limit}&limit=${limit}`;
    const resp = await fetch(url, { headers: hrHeaders(cookie), credentials: "include" });
    if (!resp.ok) {
      log(`HackerRank API returned ${resp.status}. Your cookie might be expired or invalid.`);
      break;
    }

    const data = await resp.json();
    const models = data.models || [];
    if (!models.length) {
      log("No more submissions found.");
      break;
    }

    log(`Loaded ${models.length} submissions from offset ${page * limit}`);

    let reachedSaved = false;
    for (const m of models) {
      const slug = m.challenge && m.challenge.slug;
      if (!slug) continue;

      const link = `challenges/${slug}/submissions/code/${m.id}`;
      if (lastSaved && link === lastSaved) {
        log(`Reached previously saved submission (${m.challenge.name}). Stopping pagination.`);
        reachedSaved = true;
        break;
      }
      if (m.status !== "Accepted") {
        log(`Skipping '${m.challenge.name}' because result is '${m.status}' (not 'Accepted').`);
        continue;
      }

      const sub = {
        title: m.challenge.name,
        language: m.language,
        problem: `/challenges/${slug}`,
        status: m.status,
        link,
        id: m.id
      };
      // Capture code if the list API includes it (avoids a separate fetch)
      if (m.code && typeof m.code === "string") sub.code = m.code;
      if (m.compilable_code && typeof m.compilable_code === "string") sub.code = m.compilable_code;

      found.push(sub);
      log(`Found new accepted submission: ${m.challenge.name} (${m.language})`);
    }

    if (reachedSaved) break;
    page += 1;
    await sleep(500);
  }

  return found;
}

function findCode(node) {
  if (typeof node !== "object" || node === null) return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const result = findCode(item);
      if (result) return result;
    }
    return null;
  }

  if (typeof node.code === "string") {
    const c = node.code;
    if (c.length > 5 && (
      /[{}();=\n]/.test(c)
      || c.includes("#include")
      || c.includes("using namespace")
      || c.trimStart().startsWith("def ")
      || c.trimStart().startsWith("import ")
    )) return c;
  }
  for (const key of ["source", "source_code"]) {
    if (typeof node[key] === "string" && node[key].length > 5) return node[key];
  }
  for (const value of Object.values(node)) {
    const result = findCode(value);
    if (result) return result;
  }
  return null;
}

// Returns the source code, or null when HackerRank will not give it up.
// Never return a placeholder: a placeholder written to the repo reads as a
// real solution, and because it lands in the state file the cursor moves past
// it so it is never retried. Callers treat null as "skip, try again later".
async function fetchCode(cookie, submission, log) {
  if (submission.code && submission.code.trim().length > 5) {
    return submission.code;
  }

  // Strategy 1: REST API (most reliable — returns JSON directly)
  if (submission.id) {
    try {
      const apiUrl = `${HACKERRANK_ROOT}/rest/contests/master/submissions/${submission.id}`;
      const apiResp = await fetch(apiUrl, {
        headers: hrHeaders(cookie),
        credentials: "include"
      });
      if (apiResp.ok) {
        const apiData = await apiResp.json();
        const model = apiData.model || apiData;
        const apiCode = model.code || model.source || model.compilable_code || "";
        if (apiCode && apiCode.trim().length > 5) {
          return apiCode;
        }
      }
    } catch (e) { /* fall through */ }
  }

  // Strategy 2: HTML page — parse initialData JSON
  const pageUrl = /^https?:/i.test(submission.link)
    ? submission.link
    : `${HACKERRANK_ROOT}/${submission.link.replace(/^\/+/, "")}`;

  try {
    const resp = await fetch(pageUrl, {
      headers: hrHeaders(cookie),
      credentials: "include"
    });
    if (resp.ok) {
      const html = await resp.text();
      const match = html.match(/<script\s+id="initialData"[^>]*>([\s\S]*?)<\/script>/i);
      if (match) {
        try {
          const json = JSON.parse(decodeURIComponent(match[1]));
          const found = findCode(json);
          if (found) return found;
        } catch (e) { /* parse error, fall through */ }
      }
    }
  } catch (e) { /* network error, fall through */ }

  log(`Could not retrieve code for '${submission.title}' (${submission.id}) - skipping, will retry next sync.`);
  return null;
}

function extensionFor(language) {
  return resolveLanguage(language).ext;
}

function resolveLanguage(language) {
  const lang = String(language == null ? "" : language).trim().toLowerCase();
  const raw = String(language == null ? "" : language).trim();
  if (lang.includes("c#") || lang.includes("csharp") || lang === "cs") return { display: "C#", ext: ".cs" };
  if (lang.includes("c++") || /^cpp/.test(lang)) return { display: "C++", ext: ".cpp" };
  if (lang.includes("java")) return { display: "Java", ext: ".java" };
  if (lang.includes("python") || lang.includes("pypy")) return { display: "Python", ext: ".py" };
  if (lang.includes("javascript") || lang === "js" || lang === "node") return { display: "JavaScript", ext: ".js" };
  if (lang.includes("typescript") || lang === "ts") return { display: "TypeScript", ext: ".ts" };
  if (lang === "go" || lang === "golang") return { display: "Go", ext: ".go" };
  if (lang.includes("ruby")) return { display: "Ruby", ext: ".rb" };
  if (lang.startsWith("c")) return { display: "C", ext: ".c" };
  return { display: raw || "Other", ext: "" };
}

function sanitizeFileName(title) {
  return String(title).replace(/[/\\]/g, "_");
}

function mdText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function mdLink(path) {
  return `<${String(path).replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
}

function problemUrl(problem) {
  const p = String(problem == null ? "" : problem).trim();
  if (!p) return "";
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  return `${HACKERRANK_ROOT}${p.startsWith("/") ? p : `/${p}`}`;
}

function compareKeys(a, b) {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function buildReadme(state, repoName) {
  // Must stay byte-for-byte identical to build_readme() in scripts/relay.py —
  // otherwise the two clients overwrite each other's README on alternating syncs.
  const lines = [
    `# ${repoName}`,
    "",
    "Collection of Solutions to various HackerRank Problems.",
    ""
  ];

  const groups = new Map();
  const seen = new Set();
  let total = 0;

  for (const entry of state || []) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const title = String(entry[0] == null ? "" : entry[0]);
    const problem = String(entry[2] == null ? "" : entry[2]);
    const { display, ext } = resolveLanguage(entry[1]);
    const key = `${display}\u0000${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!groups.has(display)) groups.set(display, []);
    groups.get(display).push({ title, problem, ext });
    total += 1;
  }

  if (total === 0) {
    lines.push("_No solutions synced yet._", "");
    return lines.join("\n");
  }

  lines.push(
    `**${total} ${total === 1 ? "solution" : "solutions"}** across **${groups.size} ${groups.size === 1 ? "language" : "languages"}**.`,
    ""
  );

  for (const display of Array.from(groups.keys()).sort(compareKeys)) {
    const rows = groups.get(display).sort((a, b) => compareKeys(a.title, b.title));
    lines.push(`## ${display} (${rows.length})`, "");
    for (const row of rows) {
      let line = `- [${mdText(row.title)}](${mdLink(`submissions/${sanitizeFileName(row.title)}${row.ext}`)})`;
      if (row.problem) {
        line += ` — [HackerRank](${mdLink(problemUrl(row.problem))})`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildContent(submission, code, author) {
  const lang = submission.language.toLowerCase();
  const isPython = lang.includes("python") || lang.includes("pypy");
  let content = isPython ? "'''-----------------------------------------------------------------------\n" : "/*-----------------------------------------------------------------------\n";
  content += `\nProblem Title: ${submission.title}`;
  content += `\nProblem Link: ${submission.problem}`;
  content += `\nAuthor: ${author}`;
  content += `\nLanguage: ${submission.language}`;
  content += isPython ? "\n\n-----------------------------------------------------------------------'''\n\n" : "\n\n-----------------------------------------------------------------------*/\n\n";
  content += "\n" + code;
  return content;
}

function filePathFor(submission) {
  const fileName = sanitizeFileName(submission.title);
  return `submissions/${fileName}${extensionFor(submission.language)}`;
}

function encodePath(segments) {
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64Decode(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function github(url, token, options = {}) {
  const resp = await fetch(url, { ...options, headers: { ...ghHeaders(token), ...(options.headers || {}) } });
  return resp;
}

async function ensureRepository(token, name, log) {
  const meResp = await github(`${GITHUB_ROOT}/user`, token);
  if (meResp.status === 401) throw new Error("Unable to authenticate to GitHub: invalid Personal Access Token.");
  if (!meResp.ok) throw new Error(`GitHub authentication failed (${meResp.status}).`);
  const me = await meResp.json();
  log(`GitHub Authentication Successful (User: @${me.login})`);

  const repoUrl = `${GITHUB_ROOT}/repos/${me.login}/${encodeURIComponent(name)}`;
  const repoResp = await github(repoUrl, token);
  if (repoResp.ok) {
    log(`Submissions repo '${name}' found.`);
    return { login: me.login, repo: name };
  }
  if (repoResp.status !== 404) {
    throw new Error(`GitHub repository lookup failed (${repoResp.status}).`);
  }

  log(`Repository '${name}' not found - creating new repository on GitHub...`);
  const createResp = await github(`${GITHUB_ROOT}/user/repos`, token, {
    method: "POST",
    body: JSON.stringify({
      name,
      private: false,
      description: "Collection of Solutions to various HackerRank Problems"
    })
  });
  if (!createResp.ok) throw new Error(`Could not create repository (${createResp.status}).`);

  const readmePath = encodePath([name, "contents/README.md"]);
  const readmeResp = await github(`${GITHUB_ROOT}/repos/${me.login}/${readmePath}`, token, {
    method: "PUT",
    body: JSON.stringify({ message: "initial commit", content: base64Encode(`# ${name}`) })
  });
  if (!readmeResp.ok) throw new Error(`Could not create README.md (${readmeResp.status}).`);
  log("Repo & README.md created successfully");
  return { login: me.login, repo: name };
}

async function loadState(token, login, repo, log) {
  const path = encodePath([repo, "contents", "submissions.json"]);
  const resp = await github(`${GITHUB_ROOT}/repos/${login}/${path}`, token);
  if (resp.ok) {
    const contents = await resp.json();
    const subs = JSON.parse(base64Decode(contents.content));
    log(`Loaded existing index (${Array.isArray(subs) ? subs.length : 0} previous submissions synced).`);
    return Array.isArray(subs) ? subs : [];
  }
  if (resp.status === 404) {
    log("Initializing new submissions tracking file in repository...");
    return [];
  }
  throw new Error(`Could not load submissions.json (${resp.status}).`);
}

async function saveState(token, login, repo, state, log) {
  const path = encodePath([repo, "contents", "submissions.json"]);
  const url = `${GITHUB_ROOT}/repos/${login}/${path}`;
  const existing = await github(url, token);
  const body = {
    message: "updated submissions.json",
    content: base64Encode(JSON.stringify(state))
  };
  if (existing.ok) {
    body.sha = (await existing.json()).sha;
  } else {
    body.message = "created submissions.json";
  }
  const resp = await github(url, token, { method: "PUT", body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Could not update submissions.json (${resp.status}).`);
  log("submissions.json index updated successfully");
}

async function saveReadme(token, login, repo, state, log) {
  // Regenerates README.md on every sync, including no-op ones, so a
  // hand-edited or deleted README self-heals.
  const content = buildReadme(state, repo);
  const path = encodePath([repo, "contents", "README.md"]);
  const url = `${GITHUB_ROOT}/repos/${login}/${path}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const existing = await github(url, token);
    const body = {
      message: "updated README.md",
      content: base64Encode(content)
    };

    if (existing.ok) {
      const contents = await existing.json();
      if (base64Decode(contents.content) === content) {
        log("README.md already up to date.");
        return;
      }
      body.sha = contents.sha;
    } else if (existing.status === 404) {
      body.message = "created README.md";
    } else {
      throw new Error(`Could not inspect README.md (${existing.status}).`);
    }

    const resp = await github(url, token, { method: "PUT", body: JSON.stringify(body) });
    if (resp.ok) {
      log("README.md updated successfully");
      return;
    }
    if (resp.status === 409 && attempt < 3) {
      log(`SHA conflict on README.md attempt ${attempt}, retrying...`);
      await sleep(1000);
      continue;
    }
    throw new Error(`Could not write README.md (${resp.status}).`);
  }
}

async function uploadSubmission(token, login, repo, submission, code, author, log) {
  const filePath = filePathFor(submission);
  const url = `${GITHUB_ROOT}/repos/${login}/${encodePath([repo, "contents", ...filePath.split("/")])}`;

  const body = {
    message: `added ${filePath}`,
    content: base64Encode(buildContent(submission, code, author))
  };

  const existing = await github(url, token);
  if (existing.ok) {
    const contents = await existing.json();
    if (base64Decode(contents.content) === body.content) {
      log(`  -- file '${filePath}' already up to date`);
      return;
    }
    body.message = `updated ${filePath}`;
    body.sha = contents.sha;
    log("  -- updated existing file");
  } else if (existing.status !== 404) {
    throw new Error(`Could not inspect file '${filePath}' (${existing.status}).`);
  } else {
    log("  -- created new file");
  }

  const resp = await github(url, token, { method: "PUT", body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Could not write '${filePath}' (${resp.status}).`);
}

function sanitizeInput(value, label, log) {
  let raw = String(value == null ? "" : value).trim().replace(/^["']+|["']+$/g, "");
  if (label === "session cookie") raw = raw.replace(/^_hrank_session=\s*/, "");
  const clean = raw.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, "");
  if (clean.length !== raw.length) {
    log(`Note: removed ${raw.length - clean.length} formatting/non-ASCII character(s) from ${label} (stray copy-paste characters).`);
  }
  return clean;
}

async function runSync(config, log) {
  const token = sanitizeInput(config.token, "GitHub token", log);
  const repo = sanitizeInput(config.repo, "repository name", log);
  const explicitCookie = sanitizeInput(config.cookie, "session cookie", log);
  const cookieValue = explicitCookie || (await getSessionCookie());
  if (!token) throw new Error("Please provide a GitHub Personal Access Token.");
  if (!repo) throw new Error("Please provide a GitHub repository name.");
  if (!cookieValue) {
    throw new Error("No HackerRank session cookie found. Log in to HackerRank (or paste your cookie in the popup).");
  }
  log("HackerRank Session Initialized");

  const { login } = await ensureRepository(token, repo, log);
  const saved = await loadState(token, login, repo, log);
  const lastSaved = saved.length ? saved[0][4] : undefined;

  let newSubs = await fetchSubmissions(cookieValue, lastSaved, log);

  // Deduplicate: keep only the latest submission per (title, language).
  // Submissions arrive newest-first, so the first occurrence wins.
  const seen = new Set();
  const unique = [];
  for (const sub of newSubs) {
    const key = `${sub.title}\0${sub.language}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(sub);
    }
  }
  if (unique.length !== newSubs.length) {
    log(`Deduplicated: ${newSubs.length} submissions → ${unique.length} unique problems.`);
    newSubs = unique;
  }

  if (!newSubs.length) {
    log("No new submissions found! Nothing to update.");
    await saveReadme(token, login, repo.trim(), saved, log);
    return;
  }

  log(`Fetching source code for ${newSubs.length} submission(s)...`);
  const fetched = [];
  for (let i = 0; i < newSubs.length; i++) {
    const submission = newSubs[i];
    log(` - fetching code for submission ${i + 1}. ${submission.title}`);
    fetched.push({ submission, code: await fetchCode(cookieValue, submission, log) });
    await sleep(400);
  }

  // Only submissions whose source we actually retrieved get committed and
  // recorded. Anything else is left out of the state file on purpose: the
  // cursor is state[0], so a submission that is never recorded stays *ahead* of
  // the cursor and the next sync naturally re-fetches it.
  //
  // Note we commit every success, even one that sits below a failure. Stopping
  // at the first failure instead would look tidier but loses data: fetchSubmissions()
  // halts at the first state entry, so anything older than the newest commit is
  // unreachable regardless. For [C ok, B fails, A ok], committing only the
  // prefix [C] strands B *and* A, whereas committing [C, A] salvages A. A
  // submission that is both older than the cursor and failed is lost in either
  // strategy; that is a limitation of the single-cursor state format, not
  // something this loop can fix.
  const committed = fetched.filter((f) => f.code !== null);
  const skipped = fetched.filter((f) => f.code === null);

  for (const f of skipped) {
    log(` -- SKIPPED '${f.submission.title}': source unavailable, no file written, will retry next sync.`);
  }

  if (committed.length) {
    log(`Updating repo for ${committed.length} new submission(s)...`);
    for (let i = 0; i < committed.length; i++) {
      const { submission, code } = committed[i];
      log(` - updating repo with submission ${i + 1}. ${submission.title}`);
      await uploadSubmission(token, login, repo, submission, code, login, log);
    }

    const stateEntries = committed.map(
      (f) => [f.submission.title, f.submission.language, f.submission.problem, f.submission.status, f.submission.link]
    );
    const mergedState = stateEntries.concat(saved);
    await saveState(token, login, repo.trim(), mergedState, log);
    await saveReadme(token, login, repo.trim(), mergedState, log);
  } else {
    log("No submissions could be retrieved this run - state file left unchanged.");
    await saveReadme(token, login, repo.trim(), saved, log);
  }
}

api.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.action !== "sync") return;
    try {
      await runSync(msg.config || {}, (line) => port.postMessage({ type: "log", line }));
    } catch (e) {
      port.postMessage({ type: "log", line: `[Error] ${e && e.message ? e.message : e}` });
    } finally {
      port.postMessage({ type: "done" });
    }
  });
});
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

async function fetchCode(cookie, submission, log) {
  const FALLBACK = "// Could not fetch code snippet";

  // If code was already captured from the submissions list API, use it
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

  return FALLBACK;
}

function extensionFor(language) {
  const lang = String(language).toLowerCase();
  if (lang.includes("c#") || lang.includes("csharp") || lang === "cs") return ".cs";
  if (lang.includes("c++") || /^cpp/.test(lang)) return ".cpp";
  if (lang.includes("java")) return ".java";
  if (lang.includes("python") || lang.includes("pypy")) return ".py";
  if (lang.includes("javascript") || lang === "js" || lang === "node") return ".js";
  if (lang.includes("typescript") || lang === "ts") return ".ts";
  if (lang === "go" || lang === "golang") return ".go";
  if (lang.includes("ruby")) return ".rb";
  if (lang.startsWith("c")) return ".c";
  return "";
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
  const fileName = submission.title.replace(/[/\\]/g, "_");
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
    return;
  }

  log(`Fetching source code for ${newSubs.length} submission(s)...`);
  const codes = [];
  for (let i = 0; i < newSubs.length; i++) {
    const submission = newSubs[i];
    log(` - fetching code for submission ${i + 1}. ${submission.title}`);
    codes.push(await fetchCode(cookieValue, submission, log));
    await sleep(400);
  }

  log(`Updating repo for ${newSubs.length} new submission(s)...`);
  for (let i = 0; i < newSubs.length; i++) {
    const submission = newSubs[i];
    log(` - updating repo with submission ${i + 1}. ${submission.title}`);
    await uploadSubmission(token, login, repo, submission, codes[i], login, log);
  }

  const stateEntries = newSubs.map((s) => [s.title, s.language, s.problem, s.status, s.link]);
  await saveState(token, login, repo.trim(), stateEntries.concat(saved), log);
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
"use strict";
/**
 * End-to-end tests for runSync() against a stubbed HackerRank + GitHub.
 *
 * The behaviour guarded here is the one that silently destroyed repositories
 * before: a submission whose source could not be retrieved must NOT be written
 * as a placeholder, and must NOT be recorded in submissions.json. Because the
 * sync cursor is state[0], withholding a failed submission keeps the cursor
 * behind it so the next sync naturally retries it.
 *
 * Run: node extension/tools/synctest.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const probe = `this.__probe = { runSync }; this.__api = api;`;

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s) => Buffer.from(s, "base64").toString("utf8");

/** Build a submissions/ page whose initialData carries `code` (null = unavailable). */
function hrPage(code) {
  if (code === null) return { status: 404, body: "<html><head><title>HackerRank</title></head></html>" };
  const initial = encodeURIComponent(JSON.stringify({ submission: { code } }));
  return {
    status: 200,
    body: `<html><head><script id="initialData" type="application/json">${initial}</script></head></html>`
  };
}

/**
 * @param files    initial GitHub file map, e.g. { "submissions.json": "<raw text>" }
 * @param models   HackerRank submissions-list API models, newest first
 * @param codeById map of submission id -> source, or null for "unavailable"
 */
function makeSandbox(files, models, codeById) {
  const gh = {};
  for (const [k, v] of Object.entries(files)) gh[k] = { text: v, sha: "sha-" + k };
  const writes = [];

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    browser: {
      cookies: { get: async () => ({ value: "test-cookie" }) },
      runtime: { onConnect: { addListener: () => {} } }
    },
    fetch: async (url, opts = {}) => {
      const u = String(url).replace(/%2F/g, "/");
      const method = opts.method || "GET";

      // ---- GitHub ----
      if (u.includes("api.github.com")) {
        if (u.endsWith("/user")) {
          return { ok: true, status: 200, json: async () => ({ login: "me" }) };
        }
        if (!u.includes("/contents/")) {
          // repo-exists probe
          return { ok: true, status: 200, json: async () => ({}) };
        }
        const key = decodeURIComponent(u.split("/contents/")[1]);
        if (method === "PUT") {
          const body = JSON.parse(opts.body);
          gh[key] = { text: unb64(body.content), sha: "sha-" + key };
          writes.push({ key, message: body.message, hadSha: "sha" in body });
          return { ok: true, status: 200, json: async () => ({}) };
        }
        if (gh[key]) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ sha: gh[key].sha, content: b64(gh[key].text) })
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }

      // ---- HackerRank ----
      if (u.includes("/rest/contests/master/submissions/")) {
        if (u.includes("?offset=")) {
          const offset = Number(/offset=(\d+)/.exec(u)[1]);
          return { ok: true, status: 200, json: async () => ({ models: models.slice(offset, offset + 20) }) };
        }
        // per-submission REST endpoint: 405 in the real world
        const id = u.split("/").pop();
        return { ok: false, status: 405, json: async () => ({}) };
      }
      if (u.includes("/submissions/code/")) {
        const id = Number(u.split("/").pop());
        const page = hrPage(codeById[id] === undefined ? null : codeById[id]);
        return { ok: page.status === 200, status: page.status, text: async () => page.body, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx);
  vm.runInContext(probe, ctx);

  return {
    run: sandbox.__probe.runSync,
    gh,
    writes,
    logs: [],
    state: () => JSON.parse(gh["submissions.json"].text),
    files: () => Object.keys(gh).filter((k) => k.startsWith("submissions/")),
  };
}

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` +
    (ok ? "" : `\n        got  =${JSON.stringify(actual)}\n        want =${JSON.stringify(expected)}`));
}
function checkThat(name, cond, detail = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}` + (cond ? "" : `\n        ${detail}`));
}

const ALPHA = { id: 100, challenge: { slug: "alpha", name: "Alpha" }, language: "python3", status: "Accepted" };
const BRAVO = { id: 200, challenge: { slug: "bravo", name: "Bravo" }, language: "cpp", status: "Accepted" };
const NEWEST_FIRST = [BRAVO, ALPHA];

/** A repo that already tracks one older submission, so the cursor is meaningful. */
const SEEDED = JSON.stringify([
  ["Oldie", "python3", "/challenges/oldie", "Accepted", "challenges/oldie/submissions/code/1"]
]);

(async () => {
  // ── 1. happy path ──────────────────────────────────────────────────────
  {
    const s = makeSandbox({}, NEWEST_FIRST, { 200: 'int main(){return 0;}', 100: "print('a')" });
    await s.run({ token: "t", repo: "repo", cookie: "c" }, (l) => s.logs.push(l));

    check("happy path writes one file per submission", s.files().sort(), ["submissions/Alpha.py", "submissions/Bravo.cpp"]);
    check("happy path indexes both, newest first", s.state().map((e) => e[0]), ["Bravo", "Alpha"]);
    check("happy path README lists both", /Bravo[\s\S]*Alpha/.test(s.gh["README.md"].text), true);
    checkThat("no file contains the old placeholder sentinel",
      !s.files().some((f) => s.gh[f].text.includes("Could not fetch code snippet")));
  }

  // ── 2. the NEWEST submission is unavailable: it stays ahead of the cursor ─
  {
    const s = makeSandbox({ "submissions.json": SEEDED }, NEWEST_FIRST, { 200: null, 100: "print('a')" });
    await s.run({ token: "t", repo: "repo", cookie: "c" }, (l) => s.logs.push(l));

    check("no file is written for the failed submission", s.files(), ["submissions/Alpha.py"]);
    check("Alpha was retrievable, so it is committed rather than dropped", s.files().length, 1);
    check("the failed submission is absent from the index",
      s.state().map((e) => e[0]), ["Alpha", "Oldie"]);
    check("cursor sits at Alpha, so Bravo is still AHEAD of it and reachable",
      s.state()[0][4], "challenges/alpha/submissions/code/100");
    checkThat("skip is reported to the user",
      s.logs.some((l) => l.includes("SKIPPED") && l.includes("Bravo")),
      s.logs.join("\n"));
    check("README omits the skipped submission", s.gh["README.md"].text.includes("Bravo"), false);
  }

  // ── 3. next sync retries it, because the cursor never moved past it ────
  {
    const s = makeSandbox({ "submissions.json": SEEDED }, NEWEST_FIRST, { 200: null, 100: "print('a')" });
    await s.run({ token: "t", repo: "repo", cookie: "c" }, (l) => s.logs.push(l));
    check("precondition: Bravo absent after run 1", s.files(), ["submissions/Alpha.py"]);

    // Bravo's source is available now (e.g. the cookie had been blocked).
    // Seed the whole repo as run 1 left it, not just the state file.
    const carried = {};
    for (const [k, v] of Object.entries(s.gh)) carried[k] = v.text;
    const s2 = makeSandbox(carried, NEWEST_FIRST,
      { 200: "int main(){return 0;}", 100: "print('a')" });
    await s2.run({ token: "t", repo: "repo", cookie: "c" }, (l) => s2.logs.push(l));

    check("retry writes the previously missing file", s2.files().sort(),
      ["submissions/Alpha.py", "submissions/Bravo.cpp"]);
    check("retry indexes it above the existing entries",
      s2.state().map((e) => e[0]), ["Bravo", "Alpha", "Oldie"]);
    checkThat("repaired file now has real source, not a placeholder",
      s2.gh["submissions/Bravo.cpp"].text.includes("int main()"),
      s2.gh["submissions/Bravo.cpp"].text);
    checkThat("Alpha was not re-committed on the retry run",
      s2.writes.filter((w) => w.key === "submissions/Alpha.py").length === 0,
      JSON.stringify(s2.writes.map((w) => w.key)));
  }

  // ── 4. a failure in the MIDDLE: the older success is still salvaged ─────
  // Newest first: Charlie, Bravo, Alpha. Bravo fails, Alpha succeeds.
  //
  // fetchSubmissions() halts at state[0], so once Charlie is the cursor Bravo
  // is unreachable and will never be retried automatically. Committing Alpha as
  // well costs nothing and saves a good file; dropping it (stopping at the first
  // failure) would lose both Bravo and Alpha. This test pins that trade-off.
  {
    const charlie = { id: 300, challenge: { slug: "charlie", name: "Charlie" }, language: "python3", status: "Accepted" };
    const s = makeSandbox({}, [charlie, BRAVO, ALPHA], { 300: "print('c')", 200: null, 100: "print('a')" });
    await s.run({ token: "t", repo: "repo", cookie: "c" }, (l) => s.logs.push(l));

    check("both retrievable submissions are written",
      s.files().sort(), ["submissions/Alpha.py", "submissions/Charlie.py"]);
    check("only the failed one is missing from the index",
      s.state().map((e) => e[0]), ["Charlie", "Alpha"]);
    checkThat("the stranded failure is still reported, not silently dropped",
      s.logs.some((l) => l.includes("SKIPPED") && l.includes("Bravo")),
      s.logs.join("\n"));
    checkThat("no placeholder is written in place of the failure",
      !s.files().some((f) => s.gh[f].text.includes("Could not fetch code snippet")));

    // And the repo settles: no re-fetch loop, nothing churns.
    const carried = {};
    for (const [k, v] of Object.entries(s.gh)) carried[k] = v.text;
    const s2 = makeSandbox(carried, [charlie, BRAVO, ALPHA],
      { 300: "print('c')", 200: "int main(){}", 100: "print('a')" });
    await s2.run({ token: "t", repo: "repo", cookie: "c" }, (l) => s2.logs.push(l));
    check("re-sync commits nothing - the cursor is the newest entry",
      s2.writes.filter((w) => w.key.startsWith("submissions/")).length, 0);
  }

  // ── 5. everything unavailable: state file must not be touched ──────────
  {
    const original = JSON.stringify([["Old", "python3", "/challenges/old", "Accepted", "challenges/old/submissions/code/1"]]);
    const s = makeSandbox({ "submissions.json": original }, NEWEST_FIRST, { 200: null, 100: null });
    await s.run({ token: "t", repo: "repo", cookie: "c" }, (l) => s.logs.push(l));

    check("no solution files written", s.files(), []);
    check("submissions.json left byte-identical", s.gh["submissions.json"].text, original);
    check("no submissions.json write was attempted",
      s.writes.filter((w) => w.key === "submissions.json").length, 0);
    check("README still regenerated from existing state", s.gh["README.md"].text.includes("Old"), true);
  }

  // ── 5. idempotence: an unchanged repo produces no new commits ──────────
  {
    const s = makeSandbox({}, NEWEST_FIRST, { 200: "int main(){return 0;}", 100: "print('a')" });
    await s.run({ token: "t", repo: "repo", cookie: "c" }, (l) => s.logs.push(l));
    const after = JSON.stringify({ gh: s.gh, files: s.files() });

    const s2 = makeSandbox({ "submissions.json": s.gh["submissions.json"].text, "README.md": s.gh["README.md"].text },
      NEWEST_FIRST, { 200: "int main(){return 0;}", 100: "print('a')" });
    await s2.run({ token: "t", repo: "repo", cookie: "c" }, (l) => s2.logs.push(l));

    check("re-sync commits nothing new", s2.writes.length, 0);
    checkThat("re-sync reports README already up to date",
      s2.logs.some((l) => l.includes("already up to date")), s2.logs.join("\n"));
  }

  console.log(failed ? `\n${failed} FAILURE(S)` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})();

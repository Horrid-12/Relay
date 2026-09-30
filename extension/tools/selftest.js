"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const probe = `
this.__probe = {
  findCode, extensionFor, buildContent, filePathFor, resolveLanguage, buildReadme,
  base64Encode, base64Decode, runSync, sanitizeInput
};
this.__api = api;
`;

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  TextDecoder,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  fetch: async () => { throw new Error("fetch not expected in these tests"); },
  browser: {
    cookies: { get: async () => ({ value: "test-cookie" }) },
    runtime: { onConnect: { addListener: () => {} } }
  }
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
vm.runInContext(src, context);
vm.runInContext(probe, context);

const { findCode, buildContent, extensionFor, filePathFor, resolveLanguage, buildReadme, base64Encode, base64Decode, sanitizeInput } = sandbox.__probe;
let failed = 0;
const noopLog = () => {};

function assert(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

assert("findCode picks multi-line code", findCode({ a: { b: [1, { code: "def f():\n  return 1" }] } }), "def f():\n  return 1");
assert("findCode falls back to source key", findCode({ source: "abc123" }), "abc123");
assert("findCode rejects 1-char code", findCode({ nested: { code: "x" } }), null);
assert("ext cpp", extensionFor("cpp14"), ".cpp");
assert("ext java", extensionFor("java8"), ".java");
assert("ext python", extensionFor("pypy3"), ".py");
assert("ext unknown", extensionFor("mysql"), "");

const pyContent = buildContent(
  { title: "A / B", language: "python3", problem: "/challenges/a-b" },
  "print(1)",
  "root"
);
assert("python content header + code", pyContent, "'''-----------------------------------------------------------------------\n\nProblem Title: A / B\nProblem Link: /challenges/a-b\nAuthor: root\nLanguage: python3\n\n-----------------------------------------------------------------------'''\n\n\nprint(1)");

const cppContent = buildContent(
  { title: "Sum", language: "c++", problem: "/challenges/sum" },
  "int main(){}",
  "root"
);
assert("cpp content header + code", cppContent, "/*-----------------------------------------------------------------------\n\nProblem Title: Sum\nProblem Link: /challenges/sum\nAuthor: root\nLanguage: c++\n\n-----------------------------------------------------------------------*/\n\n\nint main(){}");

assert("filePath sanitizes slashes", filePathFor({ title: "Foo / Bar", language: "cpp" }), "submissions/Foo _ Bar.cpp");
assert("base64 roundtrip unicode", base64Decode(base64Encode("héllo → wörld")), "héllo → wörld");
assert("sanitize strips leading bullet", sanitizeInput("• ghp_abc123", "GitHub token", noopLog), "ghp_abc123");
assert("sanitize keeps ascii", sanitizeInput("ghp_abc123", "GitHub token", noopLog), "ghp_abc123");
assert("sanitize cookie prefix+quotes", sanitizeInput("\"_hrank_session=abc123\"", "session cookie", noopLog), "abc123");
assert("sanitize trims", sanitizeInput("  repo-123  ", "repository name", noopLog), "repo-123");

// ── resolveLanguage ──────────────────────────────────────────────────────
assert("lang python3", resolveLanguage("python3"), { display: "Python", ext: ".py" });
assert("lang pypy3", resolveLanguage("pypy3"), { display: "Python", ext: ".py" });
assert("lang cpp14", resolveLanguage("cpp14"), { display: "C++", ext: ".cpp" });
assert("lang c# before c", resolveLanguage("c#"), { display: "C#", ext: ".cs" });
assert("lang c", resolveLanguage("c"), { display: "C", ext: ".c" });
assert("lang go not substring", resolveLanguage("django"), { display: "django", ext: "" });
assert("lang empty", resolveLanguage(""), { display: "Other", ext: "" });

// ── buildReadme ──────────────────────────────────────────────────────────
assert("readme empty state", buildReadme([], "repo"), [
  "# repo",
  "",
  "Collection of Solutions to various HackerRank Problems.",
  "",
  "_No solutions synced yet._",
  ""
].join("\n"));

assert("readme groups by language, sorted, deduped", buildReadme([
  ["Zebra", "java8", "/challenges/zebra", "Accepted", "challenges/zebra/submissions/code/3"],
  ["Beta", "python3", "/challenges/beta", "Accepted", "challenges/beta/submissions/code/2"],
  ["Alpha", "python3", "/challenges/alpha", "Accepted", "challenges/alpha/submissions/code/1"],
  ["Alpha", "python3", "/challenges/alpha", "Accepted", "challenges/alpha/submissions/code/9"]
], "hr-solutions"), [
  "# hr-solutions",
  "",
  "Collection of Solutions to various HackerRank Problems.",
  "",
  "**3 solutions** across **2 languages**.",
  "",
  "## Java (1)",
  "",
  "- [Zebra](<submissions/Zebra.java>) — [HackerRank](<https://www.hackerrank.com/challenges/zebra>)",
  "",
  "## Python (2)",
  "",
  "- [Alpha](<submissions/Alpha.py>) — [HackerRank](<https://www.hackerrank.com/challenges/alpha>)",
  "- [Beta](<submissions/Beta.py>) — [HackerRank](<https://www.hackerrank.com/challenges/beta>)",
  ""
].join("\n"));

assert("readme keeps newest duplicate link", buildReadme([
  ["Alpha", "python3", "/challenges/alpha", "Accepted", "challenges/alpha/submissions/code/9"],
  ["Alpha", "python3", "/challenges/alpha", "Accepted", "challenges/alpha/submissions/code/1"]
], "r"), [
  "# r", "", "Collection of Solutions to various HackerRank Problems.", "",
  "**1 solution** across **1 language**.", "",
  "## Python (1)", "",
  "- [Alpha](<submissions/Alpha.py>) — [HackerRank](<https://www.hackerrank.com/challenges/alpha>)",
  ""
].join("\n"));

assert("readme escapes markdown in title + slash filename", buildReadme([
  ["A [B] / C", "cpp", "/challenges/a-b-c", "Accepted", "l"]
], "r"), [
  "# r", "", "Collection of Solutions to various HackerRank Problems.", "",
  "**1 solution** across **1 language**.", "",
  "## C++ (1)", "",
  "- [A \\[B\\] / C](<submissions/A [B] _ C.cpp>) — [HackerRank](<https://www.hackerrank.com/challenges/a-b-c>)",
  ""
].join("\n"));

assert("readme normalizes bare/absolute problem url", buildReadme([
  ["Bare", "sql", "challenges/bare", "Accepted", "l"],
  ["Abs", "sql", "https://x.test/c/abs", "Accepted", "l"],
  ["None", "sql", "", "Accepted", "l"]
], "r"), [
  "# r", "", "Collection of Solutions to various HackerRank Problems.", "",
  "**3 solutions** across **1 language**.", "",
  "## sql (3)", "",
  "- [Abs](<submissions/Abs>) — [HackerRank](<https://x.test/c/abs>)",
  "- [Bare](<submissions/Bare>) — [HackerRank](<https://www.hackerrank.com/challenges/bare>)",
  "- [None](<submissions/None>)",
  ""
].join("\n"));

process.exit(failed ? 1 : 0);

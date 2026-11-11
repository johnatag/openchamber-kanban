// src/service/main.ts
import path2 from "node:path";
import { homedir } from "node:os";

// src/service/server.ts
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";

// src/service/harness.ts
import { readFile, stat } from "node:fs/promises";

// src/domain/harness.ts
var absoluteOrNull = (value) => value === null || typeof value === "string" && !value.includes("\0") && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value));
var text = (value) => typeof value === "string" && value.trim().length > 0;
var iso = (value) => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 && (offsetHour === void 0 || Number(offsetHour) < 24 && Number(offsetMinute) < 60);
};
var parseHarnessLane = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value;
  if (r.v !== 1 || !text(r.id) || !text(r.title) || !absoluteOrNull(r.project) || (typeof r.kind !== "string" || !["lane", "review", "gate"].includes(r.kind)) || !Number.isSafeInteger(r.pid) || Number(r.pid) <= 0 || !iso(r.startedAt) || !absoluteOrNull(r.report) || !absoluteOrNull(r.log) || "endedAt" in r && !iso(r.endedAt) || "outcome" in r && r.outcome !== "done" && r.outcome !== "failed") return null;
  return {
    v: 1,
    id: r.id,
    title: r.title,
    project: r.project,
    kind: r.kind,
    pid: r.pid,
    startedAt: r.startedAt,
    report: r.report,
    log: r.log,
    ..."endedAt" in r ? { endedAt: r.endedAt } : {},
    ..."outcome" in r ? { outcome: r.outcome } : {}
  };
};
var parseHarnessFeed = (input) => {
  const lanes = /* @__PURE__ */ new Map();
  const rejectedLines = [];
  const lines = input.split("\n");
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((line, index) => {
    let lane = null;
    try {
      lane = parseHarnessLane(JSON.parse(line));
    } catch {
    }
    if (lane) lanes.set(lane.id, lane);
    else rejectedLines.push(index + 1);
  });
  return { lanes: [...lanes.values()], rejected: rejectedLines.length, rejectedLines };
};
var newestHarnessLanes = (lanes) => [...lanes].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 200);
var harnessStatus = (lane, alive, reportExists) => {
  if (lane.outcome === "failed") return "failed";
  if (!lane.endedAt && alive) return "running";
  if (lane.endedAt || reportExists) return "review";
  return "lost";
};

// src/service/harness.ts
var metadata = async (file) => {
  if (file === null) return null;
  try {
    const info = await stat(file);
    return { path: file, exists: info.isFile(), mtime: info.mtimeMs };
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    return { path: file, exists: false, mtime: null };
  }
};
var isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "EPERM") return true;
    if (error.code === "ESRCH") return false;
    throw error;
  }
};
var readHarnessFeed = async (file) => {
  let input;
  try {
    input = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { lanes: [], file: "missing" };
    throw error;
  }
  const parsed = parseHarnessFeed(input);
  const lanes = await Promise.all(newestHarnessLanes(parsed.lanes).map(async (lane) => {
    const [reportFile, logFile] = await Promise.all([metadata(lane.report), metadata(lane.log)]);
    return { ...lane, status: harnessStatus(lane, isAlive(lane.pid), reportFile?.exists ?? false), reportFile, logFile };
  }));
  return { lanes, file: "ok", rejected: parsed.rejected, rejectedLines: parsed.rejectedLines };
};

// src/domain/worktree.ts
var parseGitRefOutput = (stdout) => {
  const branches = [];
  for (const line of stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (line.startsWith("refs/heads/")) branches.push({ name: line.slice("refs/heads/".length), kind: "local" });
    else if (line.startsWith("refs/remotes/")) {
      const name = line.slice("refs/remotes/".length);
      if (!name.endsWith("/HEAD")) branches.push({ name, kind: "remote" });
    }
  }
  return branches;
};

// src/service/server.ts
var json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
var git = (directory, args) => new Promise((resolve) => {
  execFile("git", ["-C", directory, ...args], {
    timeout: 8e3,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }
  }, (error, stdout, stderr) => {
    if (!error) {
      resolve({ ok: true, stdout });
      return;
    }
    if ("code" in error && error.code === "ENOENT") {
      resolve({ ok: false, status: 500, error: "git is not installed" });
      return;
    }
    if (/not a git repository/i.test(stderr)) {
      resolve({ ok: false, status: 422, error: "not a git repository" });
      return;
    }
    resolve({ ok: false, status: 500, error: stderr.trim() || error.message });
  });
});
var createServiceServer = (token2, lanesFile2) => {
  if (!path.isAbsolute(lanesFile2)) throw new Error("AIDE_LANES_FILE must be absolute");
  return http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token2}`) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/harness-lanes") {
      if (req.method !== "GET" || url.search || req.headers["transfer-encoding"] || Number(req.headers["content-length"] ?? 0) !== 0) {
        json(res, 400, { error: "harness-lanes accepts GET without parameters or body" });
        return;
      }
      void readHarnessFeed(lanesFile2).then(
        (body) => json(res, 200, body),
        (error) => {
          console.error("Could not read harness feed", error);
          json(res, 500, { error: "Could not read harness feed" });
        }
      );
      return;
    }
    if (req.method !== "GET" || url.pathname !== "/branches") {
      json(res, 404, { error: "not-found" });
      return;
    }
    const directory = url.searchParams.get("directory") ?? "";
    if (!path.isAbsolute(directory)) {
      json(res, 400, { error: "bad-request" });
      return;
    }
    void git(directory, ["for-each-ref", "--sort=-committerdate", "--count=200", "--format=%(refname)", "refs/heads", "refs/remotes"]).then((result) => {
      if (!result.ok) {
        json(res, result.status, { error: result.error });
        return;
      }
      json(res, 200, { branches: parseGitRefOutput(result.stdout) });
    });
  });
};

// src/service/main.ts
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
if (!port || !token) {
  console.error("OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
  process.exit(1);
}
var lanesFile = process.env.AIDE_LANES_FILE ?? path2.join(homedir(), ".local/share/aide/lanes.jsonl");
createServiceServer(token, lanesFile).listen(port, "127.0.0.1");

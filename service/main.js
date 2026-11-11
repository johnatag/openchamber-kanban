// src/service/main.ts
import path3 from "node:path";
import { homedir as homedir2 } from "node:os";

// src/service/server.ts
import { execFile } from "node:child_process";
import http from "node:http";
import path2 from "node:path";

// src/service/cockpit.ts
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// src/domain/cockpit.ts
var COCKPIT_STATUSES = ["todo", "in_progress", "in_review", "qa", "done"];
var keyPattern = /^[A-Z]{2,6}-\d+(\.\d+)*$/;
var text = (v, max = 4096) => typeof v === "string" && v.length <= max;
var nullableText = (v) => v == null || text(v);
var hours = (v) => v == null || typeof v === "number" && Number.isFinite(v) && v >= 0;
var slimCockpitTasks = (input) => {
  if (!Array.isArray(input)) throw new Error("Invalid Cockpit task list");
  const result = [];
  const keys = /* @__PURE__ */ new Set();
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Cockpit task");
    const r = value;
    if (!text(r.key, 128) || !keyPattern.test(r.key) || keys.has(r.key) || !text(r.title) || !COCKPIT_STATUSES.includes(r.status) || !(r.priority == null || text(r.priority, 128) || typeof r.priority === "number" && Number.isFinite(r.priority)) || !Array.isArray(r.assignees) || r.assignees.some((a) => !a || !text(a.email, 320) || !nullableText(a.name)) || !(r.parentTaskKey == null || text(r.parentTaskKey, 128) && keyPattern.test(r.parentTaskKey)) || !nullableText(r.prUrl) || !text(r.updatedAt, 128) || !Number.isFinite(Date.parse(r.updatedAt)) || !hours(r.estimateHours) || !hours(r.spentHours)) throw new Error("Invalid Cockpit task");
    keys.add(r.key);
    if (r.cancelledAt != null) continue;
    result.push({
      key: r.key,
      title: r.title,
      status: r.status,
      priority: r.priority ?? null,
      assignees: r.assignees.map((a) => ({ email: a.email, name: a.name ?? null })),
      parentTaskKey: r.parentTaskKey ?? null,
      prUrl: r.prUrl ?? null,
      updatedAt: r.updatedAt,
      estimateHours: r.estimateHours ?? null,
      spentHours: r.spentHours ?? null
    });
  }
  return result;
};

// src/service/cockpit.ts
var ENDPOINT = "https://cockpit.internal.angelsoftwares.ca/api/mcp/server";
var VERSION = "2025-03-26";
var ALLOWED_TOOLS = /* @__PURE__ */ new Set(["list_tasks", "get_task"]);
var CockpitError = class extends Error {
};
var fail = (reason) => {
  throw new CockpitError(reason);
};
var record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var readKey = async () => {
  const file = process.env.COCKPIT_API_KEY_FILE ?? path.join(homedir(), ".config/opencode/secrets/cockpit-api-key");
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat2 = await handle.stat();
      if (!stat2.isFile() || stat2.size > 16384) return fail("Cockpit API key file is invalid");
      const buffer = Buffer.alloc(16385);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const key = buffer.subarray(0, bytesRead).toString("utf8").trim();
      if (!key || bytesRead > 16384 || /[\s\x00-\x1f\x7f]/.test(key)) return fail("Cockpit API key file is empty or invalid");
      return key;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof CockpitError) throw error;
    return fail("Cockpit API key file could not be read");
  }
};
var createCockpitReader = (options = {}) => {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const maxBytes = options.maxBytes ?? 12 * 1024 * 1024;
  let cached = null;
  let expires = 0;
  let flight = null;
  const refresh = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15e3);
    try {
      const key = await readKey();
      let session = null;
      const rpc = async (method, params, id) => {
        const response = await request(ENDPOINT, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": VERSION,
            ...session ? { "Mcp-Session-Id": session } : {}
          },
          body: JSON.stringify({ jsonrpc: "2.0", method, ...params === void 0 ? {} : { params }, ...id === void 0 ? {} : { id } })
        });
        if (!response.ok) {
          await response.body?.cancel();
          return fail(response.status === 401 || response.status === 403 ? "Cockpit authentication failed" : "Cockpit HTTP request failed");
        }
        if (id === void 0) {
          await response.body?.cancel();
          if (response.status !== 202) return fail("Invalid Cockpit initialization acknowledgement");
          return;
        }
        if (method === "initialize") session = response.headers.get("mcp-session-id");
        const type = response.headers.get("content-type")?.split(";")[0]?.trim();
        if (!response.body || type !== "application/json" && type !== "text/event-stream") {
          await response.body?.cancel();
          return fail("Cockpit returned a non-JSON response");
        }
        if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
          await response.body.cancel();
          return fail("Cockpit response exceeded size limit");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        let buffer = "";
        const parse = (raw) => {
          try {
            return JSON.parse(raw);
          } catch {
            return fail("Cockpit returned malformed JSON");
          }
        };
        const validate = (body) => {
          if (!record(body) || body.jsonrpc !== "2.0" || body.id !== id || "error" in body || !("result" in body)) return fail("Cockpit returned an invalid JSON-RPC response");
          return body.result;
        };
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > maxBytes) return fail("Cockpit response exceeded size limit");
            buffer += decoder.decode(chunk.value, { stream: true });
            if (type === "text/event-stream") {
              let match;
              while (match = /\r?\n\r?\n/.exec(buffer)) {
                const event = buffer.slice(0, match.index);
                buffer = buffer.slice(match.index + match[0].length);
                const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
                if (!data) continue;
                const message = parse(data);
                if (record(message) && !("id" in message) && message.jsonrpc === "2.0" && typeof message.method === "string") continue;
                return validate(message);
              }
            }
          }
          buffer += decoder.decode();
          if (type === "text/event-stream") return fail("Cockpit stream ended without a response");
          return validate(parse(buffer));
        } finally {
          await reader.cancel().catch(() => void 0);
        }
      };
      const initialized = await rpc("initialize", { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: "openchamber-kanban", version: "1" } }, 1);
      if (!record(initialized) || initialized.protocolVersion !== VERSION || !record(initialized.capabilities) || !record(initialized.serverInfo)) return fail("Invalid Cockpit initialization response");
      await rpc("notifications/initialized");
      const callTool = async (name, args) => {
        if (!ALLOWED_TOOLS.has(name)) return fail("Cockpit tool is not permitted");
        return rpc("tools/call", { name, ...args ? { arguments: args } : {} }, 2);
      };
      const result = await callTool("list_tasks");
      if (!record(result) || result.isError) return fail("Cockpit task tool failed");
      let payload = result.structuredContent;
      if (payload === void 0) {
        if (!Array.isArray(result.content)) return fail("Invalid Cockpit task result");
        const texts = result.content.filter((c) => record(c) && c.type === "text" && typeof c.text === "string");
        if (texts.length !== 1) return fail("Invalid Cockpit task result");
        try {
          payload = JSON.parse(texts[0].text);
        } catch {
          return fail("Cockpit task tool returned malformed JSON");
        }
      }
      let tasks;
      try {
        tasks = slimCockpitTasks(record(payload) ? payload.tasks : payload);
      } catch {
        return fail("Cockpit returned invalid task records");
      }
      if (JSON.stringify(tasks).includes(JSON.stringify(key).slice(1, -1))) return fail("Cockpit returned unsafe task data");
      cached = { status: "ok", tasks };
      expires = now() + 6e4;
      return cached;
    } catch (error) {
      cached = null;
      return { status: "unavailable", reason: controller.signal.aborted ? "Cockpit request timed out" : error instanceof CockpitError ? error.message : "Cockpit network request failed" };
    } finally {
      clearTimeout(timer);
    }
  };
  return () => {
    if (flight) return flight;
    if (cached && now() < expires) return Promise.resolve(cached);
    flight = refresh().finally(() => {
      flight = null;
    });
    return flight;
  };
};

// src/service/harness.ts
import { constants as constants2 } from "node:fs";
import { open as open2, stat } from "node:fs/promises";
import os from "node:os";

// src/domain/harness.ts
var absoluteOrNull = (value) => value === null || typeof value === "string" && !value.includes("\0") && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value));
var text2 = (value) => typeof value === "string" && value.trim().length > 0;
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
  if (r.v !== 1 || !text2(r.id) || !text2(r.title) || !absoluteOrNull(r.project) || (typeof r.kind !== "string" || !["lane", "review", "gate"].includes(r.kind)) || !Number.isSafeInteger(r.pid) || Number(r.pid) <= 0 || Number(r.pid) > 2147483647 || !iso(r.startedAt) || !absoluteOrNull(r.report) || !absoluteOrNull(r.log) || "branch" in r && r.branch !== null && !text2(r.branch) || "endedAt" in r && !iso(r.endedAt) || "outcome" in r && r.outcome !== "done" && r.outcome !== "failed") return null;
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
    ..."branch" in r ? { branch: r.branch } : {},
    ..."endedAt" in r ? { endedAt: r.endedAt } : {},
    ..."outcome" in r ? { outcome: r.outcome } : {}
  };
};
var parseHarnessFeed = (input, cutFirstLine = false) => {
  const lanes = /* @__PURE__ */ new Map();
  const rejectedLines = [];
  let rejected = 0;
  const lines = input.split("\n");
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((line, index) => {
    let lane = null;
    try {
      if (!cutFirstLine || index > 0) lane = parseHarnessLane(JSON.parse(line));
    } catch {
    }
    if (lane) lanes.set(lane.id, lane);
    else {
      rejected += 1;
      if (rejectedLines.length < 50) rejectedLines.push(index + 1);
    }
  });
  return { lanes: [...lanes.values()], rejected, rejectedLines };
};
var newestHarnessLanes = (lanes) => [...lanes].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 200);
var harnessStatus = (lane, alive, reportExists) => {
  if (lane.outcome === "failed") return "failed";
  if (!lane.endedAt && alive) return "running";
  if (lane.endedAt || reportExists) return "review";
  return "lost";
};

// src/service/harness.ts
var FEED_BYTES = 4 * 1024 * 1024;
var BOOT_TOLERANCE_MS = 1e3;
var metadata = async (file) => {
  if (file === null) return null;
  try {
    const info = await stat(file);
    return { path: file, exists: info.isFile(), mtime: info.mtimeMs, size: info.size };
  } catch (error) {
    return {
      path: file,
      exists: false,
      mtime: null,
      ...error.code === "ENOENT" ? {} : { error: "unknown" }
    };
  }
};
var isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
var readHarnessFeed = async (file) => {
  let input;
  let truncated = false;
  let cutFirstLine = false;
  try {
    if (!(await stat(file)).isFile()) return { lanes: [], file: "not-regular" };
    const handle = await open2(file, constants2.O_RDONLY | constants2.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile()) return { lanes: [], file: "not-regular" };
      truncated = info.size > FEED_BYTES;
      const buffer = Buffer.alloc(Math.min(info.size, FEED_BYTES));
      const offset = Math.max(0, info.size - FEED_BYTES);
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await handle.read(buffer, used, buffer.length - used, offset + used);
        if (!bytesRead) break;
        used += bytesRead;
      }
      cutFirstLine = truncated && buffer[0] !== 10;
      input = buffer.subarray(truncated ? 1 : 0, used).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === "ENOENT") return { lanes: [], file: "missing" };
    throw error;
  }
  const parsed = parseHarnessFeed(input, cutFirstLine);
  let bootTime = Infinity;
  try {
    bootTime = Date.now() - os.uptime() * 1e3;
  } catch (error) {
    console.error("Could not determine boot time; harness liveness is unknown", error);
  }
  const lanes = await Promise.all(newestHarnessLanes(parsed.lanes).map(async (lane) => {
    const [reportFile, logFile] = await Promise.all([metadata(lane.report), metadata(lane.log)]);
    const alive = Date.parse(lane.startedAt) >= bootTime - BOOT_TOLERANCE_MS && isAlive(lane.pid);
    const reportEvidence = reportFile?.exists === true && (reportFile.size ?? 0) > 0;
    return { ...lane, status: harnessStatus(lane, alive, reportEvidence), reportFile, logFile };
  }));
  return { lanes, file: "ok", rejected: parsed.rejected, rejectedLines: parsed.rejectedLines, truncated };
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
var createServiceServer = (token2, lanesFile2, cockpit = createCockpitReader()) => {
  if (!path2.isAbsolute(lanesFile2)) throw new Error("AIDE_LANES_FILE must be absolute");
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
    if (url.pathname === "/cockpit-tasks") {
      if (req.method !== "GET" || url.search || req.headers["transfer-encoding"] || Number(req.headers["content-length"] ?? 0) !== 0) {
        json(res, 400, { error: "cockpit-tasks accepts GET without parameters or body" });
        return;
      }
      void cockpit().then((body) => json(res, 200, body));
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
    if (!path2.isAbsolute(directory)) {
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
var lanesFile = process.env.AIDE_LANES_FILE ?? path3.join(homedir2(), ".local/share/aide/lanes.jsonl");
createServiceServer(token, lanesFile).listen(port, "127.0.0.1");

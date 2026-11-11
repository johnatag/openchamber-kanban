# Architecture

A local-first Kanban board extension for OpenChamber, built with the official `@openchamber/sdk`. All task and preference data lives in `host.storage` on the connected OpenChamber server — the optional Cockpit integration reads remote task metadata through the service, and no capability beyond what's listed below is used.

Requires OpenChamber `>=1.24.0` — the Extensions SDK (`Settings → Extensions`, panels, pages, `host.storage`) doesn't exist in earlier versions.

## Manifest and capabilities

```jsonc
{
  "openchamber": {
    "apiVersion": 1,
    "engines": { "openchamber": ">=1.24.0" },
    "contributes": {
      "panel": { "id": "kanban-board", "name": "Kanban", "icon": "task", "entry": "panel/index.html" },
      "page": { "entry": "panel/page.html", "title": "Kanban board" },
      "capabilities": ["sessions", "prompt"],
      "service": { "entry": "service/main.js", "runtime": "host", "permissions": { "exec": ["git"] } }
    }
  }
}
```

| Capability | Used for |
|---|---|
| `sessions` | `listProjects`/`onProjects`, `listSessions`/`onSessions`, `listWorktrees`/`onWorktrees`, `startSession`, `openSession` — reading project/session/worktree state and creating or opening sessions. |
| `prompt` | Permits `startSession` to send its `text` field as the agent's first message. The returned `sent` value is checked because session creation can succeed without the message being delivered. |
| `service` (auto-added by declaring `contributes.service`) | The local branch, harness-feed, and Cockpit service, see below. |

**Capability approval is all-or-nothing.** The host's own grant endpoint (`PUT /api/guests/:id/capabilities`) accepts only the full requested list or `[]` — there is no partial grant. Installing this extension means accepting all three capabilities together; there is no way to get the Kanban board without also being asked about the local service.

## File structure

```
openchamber-kanban/
  package.json
  src/
    domain/
      task.ts          # Task type, validation, createTask/applyPatch/parseTask — pure, no host
      board.ts          # column grouping, filtering, drag-and-drop rank math, Review sort — pure
      sync.ts            # agent activity → task status mapping — pure
      worktree.ts         # worktree/branch picker logic, local service response parsing — pure
      unlink.ts            # link health: whether a linked session/worktree provably still exists — pure
      autoTask.ts          # orphan-session eligibility + explicit import selection + initial status + title — pure
      cockpit.ts           # slim records, filters, exact-key linking — pure
      harness.ts           # JSONL record parsing, status mapping and newest-200 selection — pure
    store/
      taskStore.ts      # one host.storage key per task: task:<id>
      prefs.ts            # filters, active tab, project tags, Cockpit settings + last-open task: host.storage key "prefs"
      orphanWatermark.ts    # "going forward" cutoff timestamp: host.storage key "orphan-watermark"
    host/
      workspace.ts      # host.listProjects/onProjects/onSessions/onWorktrees/openSession wrappers
      sessionSync.ts      # live onSessions watcher → status sync + deleted/archived session unlink
      worktreeSync.ts       # live onWorktrees watcher → worktree-deleted unlinks
      orphanSessions.ts     # live onProjects+onSessions watcher → sessions with no task yet
      branchService.ts        # calls the local git-branch service; null on any failure
      cockpitService.ts       # fixed Cockpit route + validated slim response
      harnessService.ts       # fixed harness route + validated service response
    ui/
      dnd.ts            # drop-target math — pure, no DOM
      styles.ts           # CSS using the host's --oc-* theme tokens
      dom.ts                # element() helper
      board.ts               # the Kanban board
      tabs.ts                # accessible tabs, visibility and saved selection
      cockpit.ts             # read-only Cockpit tab + visibility-scoped polling
      harness.ts             # read-only activity section + visibility-scoped polling
      detail.ts                # task detail dialog
    page.ts             # full-screen page entry (contributes.page)
    panel.ts              # rail panel entry: summary + badge
    service/
      main.ts           # local service startup (Node, not browser)
      server.ts         # authenticated branch, harness, and Cockpit HTTP routes
      cockpit.ts        # bounded read-only MCP transport + slim single-flight cache
      harness.ts        # feed read + PID and report/log metadata checks
  panel/
    index.html, page.html   # HTML shells
    main.js, page.js          # esbuild IIFE output
  service/
    main.js             # esbuild Node/ESM output of src/service/main.ts
  test/                 # node:test unit tests for domain/, store/, host/
  scripts/build.mjs      # esbuild: browser IIFE for panel/page, Node/ESM for the service
```

Layering: `domain/` has no SDK or DOM imports — pure functions, fully unit-tested. `store/` and `host/` depend only on narrow `Pick<HostClient, …>` slices, tested with in-memory fakes. `ui/` is the only layer that touches the DOM.

## Task data model

```ts
type Task = {
  schemaVersion: 1;
  id: string;                 // t_<base36 time><6 random chars>
  title: string;
  description: string;        // first message requested for the agent; delivery is checked via result.sent
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
  rank: number;                // fractional, for drag-and-drop ordering within a column
  projectId: string | null;
  sourceBranch: string | null;  // unused by current UI; kept for backward compatibility with old records
  worktree: { directory: string; branch: string | null } | null;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
  needsAttentionSince: number | null;  // set when the Review marker/sort should treat this as unseen
};
```

Stored one task per `host.storage` key (`task:<id>`), so editing one task can never corrupt another, and a malformed record is reported and skipped rather than blocking the rest of the board. Board filters, the currently-open task, and the "going forward" orphan-adoption cutoff are each a separate key (`prefs`, `orphan-watermark`).

## The board

Full-screen page (`contributes.page`) with a project filter, a search field, and five columns (Backlog, To Do, In Progress, Review, Done). The rail panel is a lightweight read-only summary (open-task count + badge) — the full board can only be opened from the sidebar's Extension pages menu, never from the extension itself.

- **Add task** is a single button. A click creates a real, persisted task immediately (title `"New task"`, appended to Backlog) and opens its detail popup for editing — no separate title field in the toolbar.
- **Drag-and-drop** uses fractional ranks (`rankAtEnd`, `planDrop`), so moving a card only ever rewrites that card and, rarely, a few neighbors whose gap became too small — never the whole column.
- **Every column has a "Move to" button** in the detail popup, one per status except the task's current one, alongside dragging.
- **The Review column sorts by urgency**, not rank: whichever task most recently needs attention leads; already-seen tasks sink below and keep normal rank order among themselves. Every other column stays rank-ordered.

### The "needs attention" marker

A task that lands in Review through something other than your own action — the live agent-status sync or auto-adopting a running session — gets `needsAttentionSince` set to that moment, shown as a warning-colored left border on its card. It's cleared the moment you open the task (its chat, or its detail popup) or drag it anywhere yourself. A status change you make deliberately (dragging, or the detail popup's own "Move to Review") never sets the marker — only the two automatic paths do.

## Agent-status sync

Implemented in `src/domain/sync.ts` (`statusForSession`, pure) and watched live by `src/host/sessionSync.ts` (`createSessionSync`, one `host.onSessions` subscription per project among currently-linked tasks):

| Session activity / outcome | Task moves to |
|---|---|
| `running`, `retrying` | In Progress (from any status except Done) |
| `waiting-question` | Review |
| `waiting-permission` | Review |
| `idle` + outcome `completed` | Review |
| `idle` + outcome `failed` | Review |
| anything else | no change |

A task marked **Done is never moved** by this — only your own "Mark Done" ever sets it. A save failure here doesn't retry on every subsequent snapshot (a live session's `onSessions` snapshot fires continuously while it runs): `lastAttemptedStatus` tracks the status this mount last attempted for a task, and only a genuinely different target status is retried, cleared on `Refresh`/reopen.

## Automatic unlinking

A task's links must not outlive what they point at. When a session is deleted, the linked task is deleted automatically. When a session is archived, or a worktree is deleted (all from OpenChamber's sidebar), the corresponding link is cleared from the task automatically — `sessionId` for a session, `worktree` for a worktree. The task itself is kept for archive/worktree cases, with its title, column, and description untouched; it simply becomes a plain unstarted card again, so **Start Agent** or **Link an existing session** can be used on it fresh. The status is deliberately left alone too — moving or archiving a card's session is not a status change.

Two mechanisms cover it, because a page-type extension only runs while it is the selected view:

- **Live** — `src/host/sessionSync.ts` reports a deleted or archived session on its existing `onSessions` subscription (no extra subscription); `src/host/worktreeSync.ts` does the same for worktrees via one `onWorktrees` subscription per project holding worktree-linked tasks. `src/domain/unlink.ts` (`sessionLinkState`, `worktreeLinkState`) decides: an archived session (`archivedAt`) is archived; an absent one is deleted only when the snapshot finished loading (`state: 'ready'`) and, for the directory the session was last seen in, the per-directory `coverage` finished too. Anything less is `unknown`, and **unknown never deletes** — an incomplete list is not a disappearance, and a false "gone" would lose the task permanently.
- **On every load** — `reconcileLinks` in `src/ui/board.ts` runs at the end of every `reload()`, before the orphan watcher starts: for each project holding linked tasks it fetches the current sessions and worktrees once (`fetchSessions`, which returns both active and full top-level session lists, and `fetchWorktrees`) and deletes tasks or clears links that provably no longer resolve. This is what catches the common case — deleting or archiving in the sidebar while the board is closed, where no live watcher was running. It runs before orphan adoption starts so a session whose stale task is being deleted can never also be re-adopted as a duplicate task.

Unlinking shows a toast naming the task. On a load-time pass it is one summary toast instead of one per task. A save failure falls back to a full reload, which re-loads the still-linked task and lets the next pass retry.

## Auto-adopting a session with no task

A session with no task pointed at it, created at or after a persisted watermark timestamp, becomes a new task automatically — In Progress while running, Review once it needs attention (question, permission prompt, finished, or failed) — using the same `statusForSession`-derived mapping (`initialStatusForNewSession` in `src/domain/autoTask.ts`), linked to that session, titled from the session's own title (or `"New session in <project>"`/`"New session (<short id>)"` when the host's own id-as-title fallback would otherwise show a raw session id).

- `src/host/orphanSessions.ts` (`watchOrphanSessions`) is a live reporter: one `onSessions` subscription per registered project, reporting every structurally-adoptable session (not a subagent, not archived, not already linked) with a resolvable status, on every snapshot. Sidebar-created sessions are therefore adopted while the board is open and are also found on the next board load if they were created while it was closed.
- `src/store/orphanWatermark.ts` holds the single cutoff: set once, the first time this feature ever runs, to that moment, and never moved again. Every session's real `createdAt` is compared against it on every board load — this is the only design that works for a page-type extension, since a page only runs while it's the selected main view, and detection cannot happen while you're in a different chat.
- `attemptedSessions` in `board.ts` guards against retrying a failed adoption on every snapshot tick, cleared on `Refresh`/reopen.
- `startingAgents` temporarily pauses adoption while a task's `startSession` request is in flight. The host can publish the new session before that request returns its id; once returned, the id is claimed and the originating task is saved with the link before navigation. A final same-session check removes any duplicate card already linked to that session.
- Subagents and archived sessions are never adopted. A toast announces each adoption.

## Start Agent

Shown in the task detail popup until a session is linked (after that, Open Chat/Unlink instead). Requires a title, description, and project; disabled with an inline reason otherwise, re-evaluated live.

**Start from** is a radio choice:
- **Project root** — run directly in the main checkout, no worktree.
- **New branch** — a fresh branch and worktree, based on the branch picked in **Based on**. Shows **Branch name** and a read-only **Folder name** that always mirrors it: `startSession`'s `{ kind: 'new', name, baseBranch }` has one `name` for both, with no way to set a folder name independently.
- **Existing worktree** — reuse a worktree already checked out (`listWorktrees`). Not the same as "check out any branch that doesn't have a worktree yet" — the SDK has no such mode, only `{ kind: 'existing', directory }` for a worktree that already exists on disk.

**Based on** is a searchable dropdown (`searchable: true`), populated from the local git-branch service when available, or the project's existing worktree branches plus "Use project default" otherwise. A new branch can't be based on itself (`branchNameConflictsWithBase`) — checked before the request is ever sent.

Clicking **Start Agent**:
1. Passes the title, description, and project currently shown in the dialog, including edits not yet saved with **Save changes**. The description becomes `text`; the current values are also saved to the task as part of the session-link update.
2. The session title uses the task title. If the title is still the default `"New task"`, `sessionTitleForTask` uses the first line of the description instead. This avoids giving a new session the generic task placeholder as its name.
3. Builds the `worktree` value (`buildSessionWorktree`) and calls `host.startSession` with `navigation: 'preserve'`. Adoption is paused during that request because the host can publish the new session before the request returns its id.
4. When a session id returns, it is claimed in `attemptedSessions`, and the existing task is saved with that id, the latest title and description, the project, In Progress status, and its worktree. The save retries three times with backoff (`saveTaskRetrying`). A same-session check removes an already-created duplicate task if one exists.
5. Checks `result.sent`. If the session was created but the description was not sent (`no-model`, `skipped`, or `failed`), the board shows an error toast. The description remains saved on the task; the SDK has no call to send a message to an arbitrary existing session afterward.
6. Clears the saved open-task preference and waits for that storage write to finish before calling `host.openSession(result.sessionId)`. The dialog therefore does not reopen when the user returns to the board.
7. On failure (`sessionId: null`), surfaces the host's own failure reason and keeps the worktree's directory in the message rather than deleting anything.

## Explicit session import

**Import running sessions** fetches sessions for every registered project. Pure `selectSessionsToImport` in `domain/autoTask.ts` accepts only running, retrying, waiting-question, and waiting-permission activity, applies structural eligibility and `initialStatusForNewSession`, and deduplicates ids while excluding linked, dismissed, and already-claimed sessions. Idle sessions, including completed or failed turns, are excluded. It has no watermark input. The board uses the same adoption writer and title rules as auto-adoption, with only the age check bypassed. Session ids are claimed synchronously before storage writes; import is disabled until tasks and projects have loaded, and reload waits for pending adoptions. Neither the cutoff nor dismissed ids are changed by import. Bulk import suppresses per-session adoption toasts and reports one summary: `Imported N`, `Nothing to import`, or `Wait for the agent that is starting`. Reload requests during import or another reload coalesce into one queued follow-up reload, so save-failure recovery is not dropped.

## Harness activity feed

`src/service/main.ts` chooses one absolute feed path at startup: `AIDE_LANES_FILE` or `~/.local/share/aide/lanes.jsonl`. Relative overrides fail startup. The SDK's service environment allowlist may omit a shell-set override, in which case the default is used. `src/service/server.ts` exposes authenticated `GET /harness-lanes`, rejecting query parameters and request bodies, and delegates to `src/service/harness.ts`. No request can select a feed path.

`domain/harness.ts` validates v1 JSONL records (including optional string-or-null branch for Cockpit linking), including required fields, integer PIDs in 1..2^31−1, absolute-or-null paths, and ISO timestamps with explicit timezone offsets. Each later valid record replaces the previous valid record with its id; malformed records are skipped and counted in `rejected`; `rejectedLines` lists only the first 50 positions (1-based within the retained window). Records are sorted by their start instant and capped at 200 before filesystem/process checks.

The service reads at most the last 4 MiB of the feed and returns `truncated` to say whether earlier bytes were omitted. For a truncated window, its first byte provides line-boundary context; any cut first record is rejected and counted as window line 1. The first context byte is not parsed. It checks regular-file metadata before opening; FIFO, device, and directory feeds return exactly `{lanes: [], file: "not-regular"}`. A nonblocking open and descriptor stat protect against replacement between that check and opening. Missing feed returns exactly `{lanes: [], file: "missing"}`; other feed read errors return HTTP 500.

Report/log paths are only stat'ed. Returned metadata is `{path, exists, mtime, size?}`, with milliseconds for mtime and bytes for size; contents are never read. Missing paths have no evidence; other stat failures add `error: "unknown"` with `exists: false, mtime: null` for that lane, without failing the feed. Only a non-empty regular report counts as evidence. Explicit failed outcome wins; otherwise a lane without `endedAt` is running only when `process.kill(pid, 0)` succeeds without error and its `startedAt` is at or after the last boot (`Date.now() - os.uptime()*1000`, allowing one second of clock tolerance). EPERM is not liveness evidence. If boot time cannot be determined, the service logs the error and makes no running claim. An end record or report evidence gives review; otherwise the lane is lost. Done is never inferred. Boot checking rules out pre-boot PID reuse; it cannot establish process identity for PID reuse within the same boot.

`host/harnessService.ts` uses a narrow `Pick<HostClient, 'serviceRequest'>` and validates the service response. `ui/harness.ts` mounts the read-only Harness tab with title, kind, project name, status, age, and copyable report path. It polls every 15 seconds, suspends while the document is hidden or the page receives `pagehide`, resumes on visibility/`pageshow`, and clears timers/listeners on board disposal. SDK 2.3.2 `API.md` and `HostClient` expose no board visibility or unmount subscription; browser page lifecycle and explicit disposal are the available hooks. Failed requests clear stale cards and show an error. Harness cards never enter task storage, task status sync, task counts, or drag/drop.

Existing manifest permissions remain sufficient: filesystem metadata and PID checks need no new SDK capability. Re-approval is not required.

## The local branch and harness service

Declared via `contributes.service` with `permissions.exec: ["git"]` — the only way to list a repository's real branches, since the SDK itself has no API for this (confirmed by enumerating every `HostClient` method).

- `src/service/main.ts` and `src/service/server.ts`, built to `service/main.js` (Node/ESM target, not the browser build) — a small HTTP server the host spawns and proxies to on `127.0.0.1`. Every request is bearer-authenticated by the host itself; the panel never sees the token or dials the port directly.
- Runs **exactly one command**: `git -C <directory> for-each-ref --sort=-committerdate --count=200 --format=%(refname) refs/heads refs/remotes` — read-only, most-recently-active branches first, capped at 200, for a project directory the panel already knows about (`path.isAbsolute` checked).
- `src/host/branchService.ts` (`fetchServiceBranches`) is best-effort: not approved, not running, a bad answer, or any other error all become `null`, never an exception the UI has to handle, because the worktree-derived fallback is a complete, working option on its own.

## Known SDK limitations

- **No API to list a repository's full branch set**, only `GuestWorktree.branch` per existing worktree, or the local service above.
- **Capability approval is all-or-nothing** across the whole manifest (see above) — there's also no cross-extension service API, so a capability can't be split into its own, separately-optional package either.
- **Chats are invisible.** A chat (a session with no project) is explicitly documented as outside any project; the `sessions` capability's methods are all scoped to registered projects. There is no SDK method to list or watch chats at all.
- **Session auto-adoption runs only while the Kanban page is active**, plus the next time it opens. A session started from the sidebar while the board is active is adopted live; one started while the board is closed is found when the board opens again, if it meets the watermark and activity rules. A session started from a task is linked directly to its existing task instead of being adopted as another task.
- **No way to set a worktree's folder name independently of its branch name** — `startSession`'s `{ kind: 'new', name }` sets both together.
- **OpenChamber's own worktree-creation can fail with "Remote branch not found" for a branch confirmed to exist on the remote and already fetched locally.** When `host.startSession` rejects for a new-branch request, the real reason doesn't survive the trip back to the extension — only a generic failure does — so the error shown names the base branch involved and suggests this is a known possibility, not a claim that the branch name is wrong.

## Install and verify

```bash
git clone <this repository>
cd openchamber-kanban
npm install
npm run check   # typecheck + unit tests + build panel/main.js, panel/page.js, service/main.js
```

In OpenChamber: **Settings → Extensions → Add** → paste this folder's absolute path → approve `sessions`, `prompt`, and the local service → open **Kanban** from the Extension pages menu above the session list.

Acceptance scenarios:

1. Create three tasks, reload OpenChamber → all three persist.
2. Drag a task between columns, reload → the new status persists.
3. Link an existing session to a task → **Open Chat** → the real session opens via `host.openSession`.
4. Edit a task title and description without clicking **Save changes**, then start an agent → the current values are saved, the description is sent when OpenChamber reports success, the same task links to the session, and the task moves to In Progress.
5. Run two tasks concurrently → they never share a session id.
6. An agent finishes a turn → the task moves to Review, never to Done, until marked Done by hand.
7. Start a session from the OpenChamber sidebar → one new task appears for it, in the column its activity implies.
8. Start an agent from a task → only the originating task is linked to that session; no second task is adopted for the same session.

## Tabs and per-project sources

`ui/tabs.ts` owns the tablist, tab/tabpanel relationships, roving tabindex, Left/Right and Home/End handling. `prefs.activeTab` defaults to `board` and persists the user's choice. If a chosen source is unavailable, Board is displayed without losing the saved choice for the next load; a source reappearing during this mount never switches tabs automatically. Focus on a hidden tab moves to the selected tab. Empty Harness/Cockpit sources hide their tabs; loading, email setup and diagnostic states remain useful content. Cancelled counts alone do not keep Cockpit visible. Search is shown only on Board. The global project filter stays accessible across tabs.

`prefs.projectTags` maps registered project ids to `work` or `personal`; unknown/missing tags default to Personal. A small native select beside the project filter edits the selected project's tag, applying Personal immediately to stop Cockpit and rolling back on save failure, with a surfaced storage error. All preference writers submit their own fields to one board-owned queue, which merges them in memory and serializes writes of the latest state. Older save completions never replace the whole preference object; failed writes roll back only fields without a newer edit. Tags for absent projects are pruned only when the project list is ready. `domain/projectScope.ts` shares the Work-scope and directory-ownership rules. Cockpit is enabled only for a registered Work project, or All projects with at least one Work project, and polling also requires a saved email. Scope disablement clears timers and shared annotations. Generation checks discard in-flight results after scope/email changes, so Personal scope cannot restart polling or display a stale response.

Harness snapshots are filtered without another service request when scope changes. Directory ownership uses exact paths or separator-bounded descendants, choosing the longest matching project path after collapsing separators, resolving `.`/`..`, stripping trailing slashes, and folding case only on macOS/Windows. Unmatched paths and null projects appear only under All projects. Lanes inherit the matched project's tag, and only Work lanes receive Cockpit annotations. Board cards likewise require their own project to be Work, including in All projects. Unchanged Harness scope does not rebuild cards, preserving copy feedback across unrelated board renders.

## Read-only Cockpit integration

`service/cockpit.ts` owns the fixed MCP origin and server-side credential file selection (`COCKPIT_API_KEY_FILE` or `~/.config/opencode/secrets/cockpit-api-key`). The authenticated `GET /cockpit-tasks` route accepts no query or body and exposes no tool selector, origin, or credential path. It initializes MCP, sends `notifications/initialized`, forwards an issued `Mcp-Session-Id`, and calls `list_tasks` with no arguments. A finally block terminates each issued session with DELETE and the session/protocol headers, including after failures; termination is fire-and-forget with a separate two-second timeout and never delays the refresh. Failures are ignored. Cache hits create no session. The internal tool allowlist contains only `list_tasks` and `get_task`; no write tool is reachable. Transport follows the [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), accepting JSON and SSE responses without following redirects.

Each refresh has a 15-second overall timeout and a 12 MiB cap per MCP response (including streamed bytes). The service validates the full task list before returning anything, omits cancelled cards while returning only their status, assignee emails and parent key as `cancelledTasks` for counts under the active Mine/subtask filters, and projects only key, title, status, priority, assignees (email/name only), parentTaskKey, prUrl, updatedAt, estimateHours, spentHours. Only this projection is cached, for exactly 60 seconds after success, with one shared in-flight refresh. Credentials are read on each refresh, never cached, logged, or included in responses. Fixed failure messages avoid reflecting remote error bodies or secrets. Failures return `{status: "unavailable", reason}` with no stale or empty task list.

`domain/cockpit.ts` validates records and implements open-assignee/subtask filters, fixed status grouping, and exact key extraction (`[A-Z]{2,6}-\d+(\.\d+)*`, with non-alphanumeric left boundaries, exact-case titles and case-insensitive branches, and dot/underscore suffixes; numeric and subtask prefix collisions are rejected). No fuzzy matching is used. `host/cockpitService.ts` validates the local response. `ui/cockpit.ts` renders separate read-only cards and polls every 60 seconds using the Harness document/page visibility lifecycle. Email and filters live in `prefs`, defaulting to no email, Mine, and no subtasks. Before email is set the view prompts without guessing and makes no service request. The shared slim snapshot also annotates Work project task and Harness title/branch matches, independent of the Cockpit view filters; failures clear annotations. Cards never enter local task storage, drag/drop, counts, or status synchronization.

Fake `node:http` MCP servers exercise the actual transport and local API without remote network or real credentials. Tests cover handshake/session propagation, allowlist isolation, slimming/secrecy, failures, bounds, cache/single-flight, preference/filter behavior, exact linking, and visibility lifecycle.

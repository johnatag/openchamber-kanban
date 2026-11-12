# OpenChamber Kanban

This is a Kanban board for OpenChamber. A Kanban board is a board with columns, like Backlog, To Do, and Done. You put tasks on cards. You move cards between columns.

This board does one more thing. It can start a real AI agent chat for a task. It keeps the task and the chat linked.

All your data stays on your own OpenChamber server. The optional Cockpit view reads task metadata from the team’s Cockpit server through the local service.

## What it does

- Click **Add task**. This creates and saves a new task right away, titled "New task", and opens it for you to edit. Later edits are saved by **Save changes** or when you click **Start Agent**.
- In the task, change the title. Add a description. The description is sent as the agent's first message.
- Choose a project.
- Click **Start Agent**. You do not need to click **Save changes** first. It uses and saves the title, description, and project you have on screen. Pick where it runs: the project's main folder, a new branch, or a worktree you already have.
- The new chat uses the task title. If the title is still "New task", it uses the first line of the description instead. The description is sent as the first message. If OpenChamber reports that it was not sent, the board tells you; the description remains saved on the task, so you can open the chat and paste it in.
- The task now links to that chat and moves to **In Progress**. Click the task card later, and it opens the same chat again.
- You can also link an already-running chat to a task, instead of starting a new one.
- Start a session from a task on this board, and it stays linked to that task. It does not create another task. Start a session from the OpenChamber sidebar, and the board can add a new task for it automatically, as described below.
- Delete a session in the OpenChamber sidebar — the linked task is deleted automatically. Archive a session, or delete a worktree — the corresponding link is cleared and the task stays on the board. You can start a new agent for it, or link another session.
- Move a task to any column two ways: drag the card, or open the task and click one of the "Move to" buttons. There is one button for every column.





<img width="1577" height="993" alt="Screenshot 2026-10-15 at 4 02 10 PM" src="https://github.com/user-attachments/assets/c738c32b-fd31-4c46-bcd1-1b450f98d45e" />
<img width="1557" height="870" alt="Screenshot 2026-10-15 at 4 01 49 PM" src="https://github.com/user-attachments/assets/02899ebb-71da-4d9a-9a8a-c609de1a7ef1" />


### The Review column moves on its own

Some tasks move to the **Review** column by themselves. You do not drag them there. This happens when:

- the agent finishes its work, or
- the agent asks you a question, or
- the agent needs a permission from you, or
- the agent's run fails.

A task never moves to **Done** by itself. Only you can mark a task Done.

A task that moved to Review, and you have not opened yet, gets an **orange border** on the left side of the card. This border means: "Look at this one." The newest such task is always at the top of the Review column, above tasks you already saw.

Open the task (click it, or click Edit), and the border goes away.

### Tasks can also appear by themselves

If you start a chat in OpenChamber another way — for example, from the sidebar — this board can still find it and make a task for it. The board adopts new, active sessions while it is open, and checks again when you open it. This only works for sessions created **after** you first open the board. Automatic adoption does not look back at older sessions. Click **Import running sessions** to add eligible active sessions of any age from all registered projects. Import includes only running, retrying, or question/permission-waiting sessions; idle sessions with completed or failed turns are excluded. Import keeps the same status and title rules, skips subagents, archived sessions, linked sessions, and sessions whose task you deleted, and leaves the automatic-adoption cutoff unchanged. Sessions started with **Start Agent** are linked to the task you started from, not adopted as another task.

## How it works (a simple picture)

```
   Kanban Board
        |
        |  click a task with no chat yet, or click Start Agent
        v
   Task Detail
        |
        |  Start Agent / Open Chat
        v
   OpenCode Chat  <-----> the real agent does the work here
        |
        |  the task stays linked to this chat
        v
   Kanban Board  (the task shows the new status, for example Review)
```

## Install

**1. Get the code.**

```bash
git clone https://github.com/<your-username>/openchamber-kanban.git
cd openchamber-kanban
```

**2. Build it.**

```bash
npm install
npm run check
```

`npm run check` does three things: it checks the TypeScript types, it runs all tests, and it builds the files OpenChamber needs. If this command finishes with no errors, the build is good.

**3. Add it to OpenChamber.**

- Open OpenChamber.
- Go to **Settings → Extensions**.
- Click **Add**.
- Paste the full folder path, for example `~/path/to/openchamber-kanban`.
- OpenChamber shows you three permissions to approve:
  - **Access projects and sessions** — lets the board see your projects and chats, and open or create chats.
  - **Send messages in your sessions** — lets **Start Agent** send your task's description as the first chat message.
  - **Run a local service** — see "What the local service does" below. This is the only reason this permission exists.
- Click **Allow and enable**.
- Open **Kanban** from the Extension pages menu, above your session list.

**Requirement:** OpenChamber version 1.24.0 or newer. Older versions do not have the Extensions feature at all.

## What the local service does

The approval screen calls this "Run a local service" and says it runs with your full user access. Here is what it does:

- It runs `git for-each-ref`, which reads repository branch names for the **Based on** dropdown in **Start Agent**. It does not write files or change git history. The board requests branches only for registered projects.
- It also reads one harness feed file: `$AIDE_LANES_FILE`, if supplied to the service as an absolute path, otherwise `~/.local/share/aide/lanes.jsonl`. Requests cannot choose a different feed file. The SDK currently forwards only a limited environment, so a variable set in your shell may not reach the host-spawned service; the default path works without it.
- Optional per-profile filter: `$AIDE_FEED_ROOTS`, colon-separated absolute normalised directories (no `.`/`..`, repeated or trailing `/`; a bad value fails service startup). When set, only rows whose `project` is the root or beneath it (path-component match, `..` normalised lexically, no symlink resolution) are returned; rows without a project or outside the roots are dropped, report/log paths outside the roots are removed from shown rows, and the response carries `filtered: {roots, dropped}` so the Harness tab always shows "Filtered to this profile: N row(s) of other profiles hidden" (N may be 0; never their titles). Only an unset or exactly empty variable disables filtering; whitespace or any malformed value fails startup, and the error names the entry number and rule, never the value. **Symlinks are not resolved:** a row whose project path lies lexically under a root is shown even if that path is a symlink to a directory elsewhere, so this is a display scope, not a security boundary. Matching is case-sensitive. Example per-profile wrapper for a work instance: `AIDE_FEED_ROOTS="$HOME/Documents/work:$HOME/Documents/worktrees/id-blu-saas" openchamber ...`. Like `AIDE_LANES_FILE`, the SDK may not forward a shell variable to the host-spawned service; verify the filter is active (the "Filtered to this profile" line appears, even with 0 hidden) before relying on it.
- Second source for the same roots, because the host starts extension services with a fixed environment allow-list (PATH, HOME, USER, XDG_*, LANG and a few more) and `AIDE_FEED_ROOTS` never reaches them: when `AIDE_FEED_ROOTS` is **unset**, the service reads `$XDG_CONFIG_HOME/aide-openchamber/feed-roots` (default `~/.config/aide-openchamber/feed-roots` when `XDG_CONFIG_HOME` is unset or not absolute). Format: a regular file (a symlink is refused), at most 64 KiB, one absolute normalised directory per line; blank lines and lines starting with `#` are ignored; at least one root is required; the file must not be writable by group or other (mode & 022 == 0, the launcher writes it 0600) or startup fails; **writer contract:** the roots file must be replaced atomically by rename; a concurrent in-place rewrite during service startup is not defended (same-UID limit); a root of exactly `/` is refused in the file ("root too broad"; only `AIDE_FEED_ROOTS` can allow it); the file is read to EOF with a 64 KiB cap and startup fails if it changes size or modification time while being read. Same validation and fail-closed rules as the variable: a present file that is a symlink, non-regular, oversized, unreadable, rootless or has a malformed line fails startup with an error naming the line number and rule, never the text. If the variable is set (even empty) it wins and the file is not read; no variable and no file means no filtering. The wrapper for each profile's instance should write this file (in that instance's `XDG_CONFIG_HOME`) rather than rely on the variable.
- For feed records it uses `ps` to read process states and start times, checks PID reachability and the last boot time, and reads report/log metadata including modification times and sizes. It prefers `/bin/ps`, falling back to PATH only if absent. It never reads report or log contents.
- It only answers authenticated OpenChamber requests on your computer. For Cockpit, it connects only to `https://cockpit.internal.angelsoftwares.ca/api/mcp/server`.

The **Harness** tab shows up to 200 newest lanes, reviews, and gates as read-only cards. It polls every 15 seconds while the board is visible. These cards are not tasks, cannot be dragged, and do not affect the task count. **Running** requires no end record, a successful PID probe, a lane start since the last boot (with one second of tolerance), and a matching `ps` start time: supervisor −2s..+2s of `startedAt`, or command −2s..+60s. An unreadable process start time supplies no liveness evidence, so the lane is **Lost** unless another PID matches or an explicit outcome applies. **Review** requires an end record with `outcome: done`; **Failed** means an explicit failed outcome; otherwise the lane is **Lost**. A `startedAt` more than five minutes in the future is always **Lost**. The newest run per id wins, with the last valid line winning within that run. Report files alone never imply Review. A failed boot-time check or unavailable `ps` is logged and prevents a Running claim. The service reads at most the last 4 MiB, marks truncated responses, counts a cut first record as rejected, and lists at most 50 rejected line numbers alongside the total (positions are relative to the retained window). FIFO, device, and directory feeds are refused; report/log stat errors affect only their lane and count as unknown evidence. A report path has a copy button; if iframe clipboard access is blocked, it opens the host's copy toast.

Known process-identity limits: PID reuse inside the matching window can still look like the original process. Zombie rows (a `ps` state starting with `Z`) are not alive and supply no liveness evidence. The supervisor window has a −2 s floor, so a writer recording `startedAt` more than two seconds after its supervisor started can make a genuine lane Lost unless its command PID matches. `ps lstart` has no timezone offset, making the repeated autumn DST hour ambiguous; on Linux, clock steps can shift derived process start times. Both can reject a genuine process. Only a normal exit 1 with empty stderr permits per-PID fallback and keeps any readable rows without logging. Exit 1 with any stderr, spawn errors, timeouts, signals, output overflow and other exit statuses retain readable rows, log once per poll and stop further queries on both batch and per-PID paths.

A missing feed is shown as missing, and malformed records are skipped with their line numbers shown. An unavailable service is shown as an error. Without the service, **Based on** still offers worktree branches and **Use project default**.

The manifest declares `git` and `ps` in the service executable permissions. Adding `ps` to the manifest may cause existing installations to ask for approval again when updating.

## What this extension cannot do

Some things are not possible with the current OpenChamber SDK (SDK = the toolkit extensions are built with). This is not a bug. It is a real limit.

- **It cannot see "Chats."** In OpenChamber, a Chat is a conversation with no project attached. This board only knows about chats inside a project. A Chat with no project never shows up here.
- **It cannot watch for new chats while you are in a different chat.** Starting a chat always switches your screen away from this board. The board can only check for new chats the next time you open it.
- **It cannot set a separate folder name for a new worktree.** The branch name and the folder name are always the same.



## Project files

See `ARCHITECTURE.md` for the full technical write-up: how each file works and the exact SDK limits behind each design choice.

## Views and project types

Use the **Board · Harness · Cockpit** tabs at the top. Board is the default; your chosen tab persists across reopening. Left/Right arrows move between visible tabs, and Home/End select the first/last. Empty source tabs are hidden, with Board shown when the saved tab is unavailable; setup prompts and errors remain available.

Select a project, then use the **Project type** control beside the project filter to tag it **Work** or **Personal**. Tags are saved on your OpenChamber server under separate `tag:<projectId>` keys; untagged projects count as Personal. Cockpit requires a saved email and at least one registered project in the selected scope that is Work in both memory and a fresh storage read before each poll. Personal and **No project** scopes do not start Cockpit requests. Switching to Personal stops polling immediately in that instance and discards in-flight results. A failed Personal save keeps Personal in memory, shows an error, and retries on the next preference write; other instances and remounts can observe the intent only once it reaches storage. Work takes effect after a successful save. Each tag record is `{value, rev}`, using a non-negative safe integer revision counter; missing or malformed revisions count as zero. Reads never write storage: legacy `{value, at}` records and plain strings read as revision zero, and the next tag write replaces them. No clock is used for tag ordering. Personal writes unconditionally at the freshly read stored revision plus one, capped at `Number.MAX_SAFE_INTEGER`. A Work click reads and remembers the stored revision immediately; when its queue runs, it writes the next revision only if the stored revision still matches. Otherwise it adopts the stored value and shows “Changed elsewhere, choose again”. Cleanup compares revisions and writes `{value: null, rev: stored + 1}` tombstones, which count as untagged Personal and preserve revision history; cleanup conflicts show no toast. Stored Personal is always adopted; stored Work can replace a local Personal choice only above this window's last successful Personal revision. At an exhausted revision, Work is refused with “This project's saved type is corrupt; Reset”. Reset saves Personal at revision 0 under a new key generation (`tag2:<projectId>`, then `tag3:<projectId>`, etc.). The highest generation wins in every window, so old keys cannot override it and fresh Work choices can advance revisions again. Personal still persists at the maximum revision until Reset. With the panel and page open together, unrelated preference writes cannot change tags, and each poll checks persisted tags and adopts Personal with “Changed elsewhere, choose again” only when a poll check finds Personal or an untagged state with a version newer than this window last saved or adopted. A stale poll check cannot override this window's newer confirmed Work; versions compare key generation first, then revision. Preferences load before writes, and queued writes re-read storage and merge only their pending field patches. An explicit startup migration moves legacy tags out of `prefs` once, tracked by a stored migration marker, using the same comparison with an expected absent key to preserve existing per-project values; later embedded tags are ignored. Storage supports only single-key writes, so the migration marker is written separately; a crash before it is harmless because migration is idempotent and existing keys win. Stale tags are tombstoned only after consecutive non-empty ready project lists omit the project for at least ten minutes.

Storage has no atomic compare-and-set: there is a read-then-write race within one storage round trip. Overlapping windows can both pass their checks before either write lands. A failed Personal write is visible only in its original window until persisted; other windows and remounts can still see stored Work, and a request already started cannot be recalled. Refused or failed storage checks retry on the normal 60-second timer while the local scope remains Work, with a fresh check before every request.

Saved tabs are restored on the next board load when available. A source that disappears returns you to Board; its reappearance does not switch tabs. Search appears only on Board. Cancelled counts follow the Cockpit Mine/subtask filters and do not keep an otherwise empty Cockpit tab visible. Tags for deleted projects are removed once the project list is ready.

Harness lanes follow the selected project by directory: an exact project path or a path beneath it belongs to that project, with the closest nested project winning. Paths collapse repeated separators and resolve `.` and `..`; matching ignores case only on macOS and Windows. Lanes without a matching project appear only in **All projects**. Lanes inherit their project's Work/Personal tag for Cockpit badges; Personal lanes never receive them.

## Cockpit work

The **Cockpit** tab is read-only. Set your email in the tab (saved in board preferences) to see your open assigned tasks, grouped by Cockpit status and preserving its board order. **Mine / All in progress** selects your open work or everybody’s in-progress work; **Include subtasks** includes child tasks. Cards show priority, spent/estimated hours, a PR link that opens externally, and a copy-key button. Work project cards and Harness lanes containing an exact Cockpit key in their title or branch show its Cockpit status too. Titles match exact case; branches match without case sensitivity and accept dot or underscore suffixes; `COC-12` never matches `COC-123`.

Only the service reads the API key, at request time, from `$COCKPIT_API_KEY_FILE` or `~/.config/opencode/secrets/cockpit-api-key`. The browser cannot choose this path or access the key. As with the harness environment override, the SDK’s limited forwarded environment may require configuring the service environment directly. The service calls only `list_tasks`; `get_task` is the only other permitted tool, reserved for exact-key lookups. No Cockpit writes occur. Large task text is removed before data reaches the board. Cancelled tasks are omitted and counted under the active filters as “N cancelled hidden” in the tab. Malformed cancelled records are skipped; only their count reaches the panel. Each refresh closes its MCP session with a best-effort DELETE.

The slim list is cached for 60 seconds and shared between simultaneous requests. The board polls every 60 seconds only while visible. Missing credentials, authentication, network, timeout, size, and malformed-response failures display **unavailable** with a reason; they never appear as “no work.”

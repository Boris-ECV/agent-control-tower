# SDLC Agent Framework — Orchestrator Instructions

You are the **orchestrator** of a multi-agent SDLC framework. Your job:
read the Jira board, delegate to subagents, verify their output against
machine-checkable exit criteria, advance ticket states, handle gates,
report to the human supervisor.

## Non-negotiable rules

1. **Jira is the single source of truth.** Any decision, progress, or
   blocker must be written to the ticket the moment it happens. Never
   keep important state only in your context.
1b. **Before reading `project-profile.yaml` or any other repo config to
   plan work, and before delegating developer/tester on a ticket,
   `git fetch origin` and check whether your current local branch (or
   `main`, if that's what you're reading from) is behind
   `origin/main`.** Someone else — a human, or this same repo edited
   from outside your session — can merge changes to `main` between your
   checks. A stale local checkout silently reading an old
   `project-profile.yaml` is a real failure mode, not a hypothetical
   one: it happened during this framework's own pilot. If behind, sync
   (`git pull` or `git merge origin/main`) before proceeding — don't
   plan work off state you haven't confirmed is current.
1c. **When counting or listing "open"/"pending"/"unanswered" tickets of
   any kind (HUMAN-INPUT, Blocked, or otherwise), do not rely on `status`
   alone, and do not rely on `resolution` alone either — verify against
   this project's actual Jira workflow first.** Two independent gaps
   commonly make a single field unreliable: (1) some states may have no
   direct transition to `Done`, so a ticket whose question was answered
   can be closed by setting `resolution` while `status` stays on an
   early state; (2) the `Done` transition may not auto-populate
   `resolution`, so genuinely completed tickets sit at `status = Done`
   with an empty `resolution`. Querying either field alone then over-
   counts in opposite directions. The query that isolates "still needs a
   human decision" is `status != Done AND resolution is EMPTY` — both
   conditions together — *if* this workflow shows both gaps; check on a
   few real tickets before asserting a count to the human, and note the
   finding in this file once confirmed. In an earlier pilot an
   orchestrator told the human "15 open HUMAN-INPUT tickets awaiting
   your answer" (true count: 0) and then proposed a fix that over-
   counted in the other direction; only verifying its own proposed
   query before shipping it caught the second mistake.
2. **Never skip exit-criteria verification.** Feeling confident is not
   verification. Run the checks (docs/02 §3) item by item.
2b. **A local `pytest` pass is not proof the PR is green — check the
   actual GitHub Actions run (`gh run list --branch <branch>`, or `gh pr
   checks`) before writing "tests pass" / "CI green" into any Jira
   comment or gate report.** If the install step fails (for example,
   you ran an install command that does not match this repo's layout)
   and you don't notice or act on the error, the following test run
   silently executes against whatever was already installed in the
   shared interpreter from an earlier, unrelated install — not against
   what the project actually declares. A subagent can also add a new
   `import` for a library that happens to be present in that shared
   environment without ever declaring it as a dependency: local tests
   pass (false positive), but the CI's clean install fails to even
   collect the test module. In an earlier pilot, three separate local
   verification passes (dev-complete, tester re-verify, G2 gate report)
   all reported success while the PR's actual CI runs were failing,
   caught only when a forced CI re-run happened to be checked.
   **Rule:** (1) always install with the exact command
   `project-profile.yaml` declares; (2) treat ANY error output from an
   install step as blocking, not noise to scroll past; (3) before
   claiming tests/CI pass in any Jira comment, confirm via `gh run
   list`/`gh pr checks` against the actual pushed commit, not just a
   local run.
2c. **A specific count a subagent states (new tests added, coverage %,
   lines changed) is a checkable fact, not a decision — re-derive it
   yourself before writing it into a Jira comment, never transcribe it.**
   Observed: a developer and a tester subagent both independently
   reported "26 new tests" for a new test file; a static
   `grep -c "^def test_"` plus counting parametrize entries, and a
   direct `pytest` run on just that file, showed 13. The overall
   "143 passed" suite-wide figure both agents also cited was correct —
   only the per-file new-test count was wrong, which is exactly the kind
   of plausible-sounding-but-wrong number that's easy to wave through
   because the headline number (tests pass) checks out. Parametrized
   tests are a common place for this: one `def test_` with N
   parametrize entries is easy to miscount or conflate with an earlier
   draft's count. Cost almost nothing to catch here since the orchestrator
   was already running the suite for G2 prep — the fix is just: always
   recompute the specific number, don't copy it from a subagent's report.
3. **Never modify `config/gates.yaml`.** Human-only file.
3b. **Posting a gate report and moving the ticket to `Awaiting Gate` are
   one atomic step, never one without the other** — for every gate,
   core or module-provided (G1, G1b, G2, and any future module gate).
   Transition the ticket's status FIRST, then post the report, so the
   two can never drift apart. A gate report asking "please comment
   GATE APPROVED" on a ticket that still shows its prior working status
   (e.g. `Designing`) is a bug: the human may look at board state
   instead of ticket comments and miss that a decision is waiting on
   them. This applies even to gates defined by modules you have not
   read in full — check the module's `hooks[].stage.gate` in its
   `module.yaml` for the exact transition, not just `config/gates.yaml`.
3c. **Immediately before posting ANY gate report, re-call the
   transitions-lookup for that ticket at its CURRENT status and confirm
   the target "Awaiting Gate" (or equivalent) transition is actually
   listed there.** Never reuse a transition ID you saw earlier in the
   session for the same ticket at a *different* status, or for a
   different ticket — transition IDs are scoped to the status they were
   queried from. This costs one extra tool call and prevents rule 3b
   silently failing (report posted, status left on the prior working
   stage). Apply this with extra suspicion right after a
   context-compaction resume: a compacted summary preserves *what* you
   did, not the granular "always re-check per-status" discipline, and
   reusing an ID that worked earlier in the (pre-compaction) session is
   a real observed failure mode, not hypothetical.
3d. **A ticket-list-level "still Awaiting Gate" status check is NOT
   sufficient grounds to tell the human a gate decision is still
   pending.** The board-level JQL query (`status not in (Done,
   Backlog)`) only proves the *status* hasn't changed — it does not
   prove no `GATE APPROVED`/`GATE REJECTED` comment has been posted.
   Jira does not auto-transition status on a gate-decision comment;
   only the orchestrator's own subsequent transition call does that.
   So after posting a gate report, the ticket correctly sits at
   `Awaiting Gate` both before AND immediately after the human answers
   it, until the orchestrator notices the comment and acts. **Rule:**
   before asserting to the human that a specific ticket's gate is
   "still awaiting your decision" — in a status update, a session
   report, or anywhere else — re-fetch that ticket's own comment
   thread (not just its status) and confirm the most recent comment
   is still the gate report itself, not a `GATE APPROVED`/`REJECTED`
   reply. Observed in an earlier pilot: the human approved a G1b gate; the
   orchestrator's board-level status checks kept correctly reporting
   `Awaiting Gate` (true) and repeatedly summarized this as "still
   waiting on your decision" (false) across several turns, including
   in a session wrap-up report, because it never re-read the ticket's
   comments after the gate report was first posted. Caught only when
   the human directly challenged the claim. Cost: one full story's
   development sat idle for roughly 70 minutes for no reason.
4. **Never push to main directly, never merge a PR that has not passed
   its gate, never force-push, never delete branches you did not create
   this session.**
4b. **Never `git commit` while the shared checkout's HEAD is on local
   `main`** — not even for a small metrics/doc commit you plan to
   branch off "in a second." Rule 4 is about push; the safest way to
   never violate it is to make on-main commits structurally impossible
   in your own workflow. `git checkout -b <branch>` first, every time.
   If unsure what HEAD is on, check `git branch --show-current` before
   committing. Observed in this framework's pilot: a metrics commit
   landed on local `main` out of habit after several branch/PR cycles;
   caught before push, but required `git branch` + `git reset --hard
   origin/main` to undo.
4c. **Rule 4's "never merge a PR that has not passed its gate" is about
   product Story PRs.** It does not require waiting on human approval
   for a narrower category: routine housekeeping PRs the orchestrator
   itself generates as a side effect of rule 4b (metrics events, PRD
   updates, design-doc commits, session/retro reports) — these were
   never gated deliverables in the first place, so there is no gate to
   wait for. **Self-merge (squash) such a PR without asking a human,
   but only when ALL of these hold:**
   - every changed file is under `metrics/`, or is `docs/PRD.md`,
     `docs/design/*.md`, `docs/session-report-*.md`, or
     `metrics/session-report-*.md`
   - **never** self-merge a PR touching `.claude/`, `config/`,
     `templates/`, `docs/00-08` (framework mechanism — always
     human-reviewed, that's how this framework's own rules evolve), or
     any product source/test/infra path
   - CI is green
   - the PR is not itself a product Story's deliverable (that still
     needs its G1/G1b/G2 gate + human approval, unchanged)

   After self-merging, note it in the ticket's next comment or a
   metrics event — self-merging quietly is still a P1/P6 violation
   (Jira/git history is how a human reconstructs what happened; don't
   make them guess which PRs a session merged on its own).
   fill gaps with assumptions.**
4d. **At G2, after a human approves the gate but before `gh pr merge`, check
   `mergeStateStatus`/`mergeable` on the PR.** A story branch can go stale
   simply from housekeeping commits (metrics events, PRD updates) landing on
   `main` while the story sat in Testing/Review/Awaiting Gate — this is
   normal, not a sign of conflict with the story's own diff. If `BEHIND`:
   `gh pr update-branch`, wait for CI to re-run on the updated head, confirm
   green, then merge. Never merge with `--admin` to force past a stale-branch
   block, and never treat "not mergeable: head branch is not up to date"
   as a reason to reopen the story or ask the human to re-approve — it is
   a mechanical branch-sync step, not a new gate decision. Observed in an
   earlier pilot: G2 was approved, but PR merge initially failed for this
   exact reason.
4e. **Before `git checkout -b <housekeeping-branch>` for a rule-4b/4c
   commit (metrics event, PRD update, etc.), explicitly `git checkout
   main` first — never assume the shared checkout is already on `main`,
   even right after your own prior git ops.** A developer/tester subagent
   delegation leaves the shared working directory checked out on
   *its* story branch when it finishes (it has no reason to switch back).
   Branching from that HEAD instead of `main` silently carries the
   subagent's entire uncommitted-to-main story diff into what you
   believe is a metrics-only branch — the commit only *adds* your one
   event line, but the branch's ancestry already contains the story's
   commits, so squash-merging it per rule 4c's self-merge path pushes
   unreviewed, ungated story code straight to `main`. Rule 4c's file-path
   checklist does not catch this, because it describes what you *meant*
   to change, not what the branch actually contains. **Two independent
   guards, both required:** (1) always `git checkout main` (not just
   `git checkout -b ...` from whatever HEAD happens to be) before cutting
   a housekeeping branch; (2) before pushing/self-merging any rule-4c
   branch, run `git diff main --stat` against the branch's *parent*
   commit (i.e. confirm the branch is one commit ahead of `main` with
   only the intended file(s) changed) — if anything besides the intended
   metrics/doc file shows up, stop and investigate before pushing.
   Observed in an earlier pilot: exactly this sequence squash-merged an
   entire unreviewed e2e-scaffold story (package manifest, e2e runner
   config, e2e server and smoke test) into `main` under a PR titled as a
   metrics commit; caught immediately after by re-reading the merge diff, fixed
   with a follow-up revert PR (the story's own branch was untouched and
   unaffected, since revert only rewrites `main`'s history, not the
   story branch's).
6. **Follow the lock protocol (docs/01 §4) before working on any ticket.**
7. **Emit metrics events** (docs/07 schema) to `metrics/events.jsonl` for
   every stage transition, gate review, reopen, escalation, block/unblock.
   Never append via a Bash heredoc with the JSON inline in the command
   text (`cat >> ... << 'EOF' {...} EOF`) — the brace+quote combo trips
   the Bash safety heuristic on every single call. Instead: Write the
   one-line event JSON to a scratch file at the FIXED path
   `.tmp/event.jsonl` (overwrite it each time, never a new filename —
   `permissions.allow` wildcards only match at the end of the string,
   not mid-command, so a fixed path is what makes an allow rule stick
   across calls), then `cat .tmp/event.jsonl >> metrics/events.jsonl`
   via Bash (docs/07 §1 "如何寫入").
7b. **Before running rule 7's `cat .tmp/event.jsonl >> metrics/events.jsonl`
   append, `git branch --show-current` first and confirm you are on
   `main`.** The append itself doesn't `git checkout` anything — it silently
   writes onto whatever branch the shared checkout's HEAD already happens
   to be, which per rule 4e is not reliably `main` after any subagent
   delegation. If not on `main`, do not append yet: stash or hold the event
   line aside, `git checkout main` (rule 4e), confirm synced, cut the
   housekeeping branch, *then* apply the append and commit. Observed in
   an earlier pilot: the orchestrator ran
   the append literally as rule 7 describes right after a developer subagent
   delegation left HEAD on the story branch — the event line landed as an
   uncommitted diff on top of the story branch, one accidental
   `git add -A` + rule-4c self-merge away from carrying unreviewed story
   code into what looked like a metrics-only PR (the exact failure rule 4e
   was written to prevent). Caught this time via `git diff --
   metrics/events.jsonl` before committing; rule 7 as originally written
   doesn't tell you to check this, so following it literally reproduces
   the race.
7c. **The Bash tool's shell working directory persists across tool calls
   within a session — including after you `cd` into a developer/tester
   worktree to inspect or verify its output.** If you don't explicitly
   `cd` back to the repo root afterward, every subsequent command
   (including rule 7b's `git branch --show-current` check, `git stash`,
   and the `metrics/events.jsonl` append) silently runs inside that
   worktree instead of the shared checkout — and `git branch
   --show-current` will *correctly* report the worktree's own branch,
   which can look like "I'm on the right branch" if you don't also
   notice it isn't `main`. This is a distinct failure mode from rule 4e
   (which covers HEAD drifting in the *shared* checkout after a
   delegation) — here the shared checkout was never touched; the
   orchestrator's own shell simply never left the worktree. **Rule:**
   after any `cd` into a worktree (to verify a subagent's branch, run
   tests independently, etc.), explicitly `cd` back to the repo root as
   your next command before doing any further git/metrics operations —
   do not rely on a later `git checkout main` alone, since `checkout`
   does not change which directory the shell is in. When in doubt,
   run `pwd` alongside `git branch --show-current`; the former catches
   what the latter can mask. Observed in an earlier pilot: after
   independently verifying
   a developer's worktree, the orchestrator's shell stayed there across
   several later calls; a `git stash pop` intended for `main` landed
   the pending `metrics/events.jsonl` edit inside the worktree instead.
   Caught via `git diff` before committing, reverted in the worktree,
   and correctly reapplied on `main` after an explicit `cd` + `pwd`
   check — no corruption, but it cost an extra recovery pass that this
   rule would have prevented.
7d. **Do not cut a second `metrics/events.jsonl` housekeeping branch (rule
   7/4c) before the previous one has actually merged to `main`.** Each
   such branch's diff is "append N lines at end of file" computed
   against whatever `main` looked like at branch-creation time. If two
   such branches are both cut before either merges, their diffs target
   the same end-of-file anchor line, and the second one to merge will
   show as `CONFLICTING`/`DIRTY` on GitHub even though semantically both
   sets of lines just need to coexist — this is a real, mechanical git
   limitation (concurrent pure-appends still conflict when the anchor
   context overlaps), not a bug in the events themselves. **If it
   happens anyway** (e.g. because a subagent delegation forced you to
   queue several housekeeping commits before circling back to merge
   them): `git fetch origin`, `git checkout <the-conflicting-branch>`,
   `git rebase origin/main`, resolve by keeping both sets of JSON lines
   in chronological `ts` order (delete only the conflict markers, never
   a real event line), confirm `git diff main <branch> --stat` shows
   only the intended file with only the expected added-line count, then
   `git push --force-with-lease` and merge — force-pushing your own
   just-created, not-yet-merged housekeeping branch this way is safe
   (rule 4's force-push restriction is about shared/published branches
   other people build on, not a same-session scratch branch you alone
   created and are about to squash-merge). **Preferred**: avoid the
   situation up front by merging each metrics housekeeping PR before
   cutting the next one, even if that means slightly more back-and-forth
   during a busy session. Observed in an earlier pilot: three separate
   metrics-append branches were
   cut in quick succession around gate processing for two stories
   before the earlier ones merged; two of the three later
   PRs conflicted exactly this way and were resolved via the rebase
   procedure above with no data loss.
8. **Respect token discipline** (config/limits.yaml): WIP limit, story cap
   per session, clean wrap-up when context gets heavy.
9. **A lesson learned beyond this single session must be promoted into a
   durable, git-tracked rule — this file, the relevant agent's `.md`, or
   the appropriate `docs/*.md` — not left as only a persistent-memory
   entry.** Saving to your own memory is fine and often useful (it can
   hold session-local nuance a terse rule can't), but memory is scoped
   to this local Claude Code installation and project path — it is NOT
   part of the git repo. It will not survive the project being copied
   into a template for a new project, will not be visible to a
   differently-scoped session, and is not reviewable by the human
   alongside the code the way a `CLAUDE.md`/docs change is. Concretely:
   whenever you write a `feedback_*`-style memory about a bug, race
   condition, or process gap, in the same turn (or a clearly-flagged
   fast-follow) also propose or make the corresponding rule edit here —
   do not treat the memory entry as sufficient on its own. This rule
   exists because it was violated repeatedly during this framework's
   pilot: six separate `feedback_*` memories accumulated in one
   project's memory store over the course of the pilot, none promoted
   to a rule, before a human caught the gap and asked for all of them
   to be written up — see rules 3c and 4b above and the Delegation
   rules below for the ones recovered this way.
10. **Auto gates have two mandatory escalation conditions.** Even when a
    gate's mode in `config/gates.yaml` is `auto`, treat it as `manual`
    (move the ticket to `Awaiting Gate` first, then post the gate
    report, then wait for a human `GATE APPROVED`, per rules 3b-3d) if:
    (a) the ticket carries the label `needs-human-gate`; or
    (b) at G2, the PR diff touches a path listed in the
        `protected_paths_untouched` criterion of `config/gates.yaml`.
    Failing these criteria is an escalation, never a rejection. Emit a
    `gate_review` event with mode `escalated-to-manual`. Never change a
    ticket's labels, or split a PR, in order to avoid triggering this
    rule. This repository is public and its `main` branch is protected
    on the platform side; this rule exists because the orchestrator runs
    with the repository owner's credentials, so the platform alone
    cannot tell an orchestrator merge from a human one.

## Bootstrap (every new session)

Follow docs/00-handover.md STEP 1-8 exactly:
read handover → architecture → workflow → gates.yaml → models.yaml +
limits.yaml → project-profile.yaml → run recovery procedure → main loop.
Also read `modules-enabled.yaml` (project root) if present — it may add
stages/gates to the state machine.

Do NOT read docs/03/04/05/07 at bootstrap; read them only when needed.

## Main loop priority order

1. Blocked tickets — resolve if possible, else confirm human was notified
2. Awaiting Gate — process gates (auto: verify criteria; manual: ensure
   gate report posted, check for human APPROVED/REJECTED comments).
   **When a G1 gate is approved, delegate reporter to add/update the
   ticket's section in `docs/PRD.md` before advancing state further** —
   this keeps the PRD a living reflection of approved scope, maintained
   incrementally instead of written upfront.
3. Stale locks (> 60 min) — recovery procedure
4. Ready tickets — claim per WIP limit, delegate to developer
5. Backlog stories with no Ready work — delegate refinement to
   requirements-analyst

## Delegation rules

- One ticket per delegation. Include in every delegation prompt:
  ticket key, full acceptance criteria (or spec text), the exact
  commands from project-profile.yaml the subagent needs, and the
  required output format ("concise summary ≤ 30 lines + artifact
  locations").
- Route to the subagent whose role matches the stage
  (see routing table in config/models.yaml). Never upgrade a model
  tier on your own — premium tier only via the escalation procedure
  (docs/02 §7, models.yaml `escalation`).
- Verify subagent output yourself against the stage exit criteria
  before advancing state. Reopen (state back + Reopen Count +1) on
  failure.
- **Transition the ticket's Jira status to match the stage you are about
  to delegate BEFORE making the delegation call, not after the subagent
  reports back.** Concretely: `Ready` → `In Progress` happens before
  delegating developer, `In Progress`/`Testing-entry` happens before
  delegating tester, etc. — not retroactively once the subagent's work is
  already done. Observed in an earlier pilot: after G1b was approved
  and the ticket sat in `Ready`, the
  orchestrator delegated developer directly without transitioning to
  `In Progress` first; the gap was only caught when verifying the
  developer's output afterward, at which point Jira had been silently
  wrong (still showing `Ready` while code was already being written) for
  the full duration of that delegation. No data was lost — Jira is the
  source of truth per rule 1, so a session dying mid-delegation with the
  status not yet updated means a future session/human reading the board
  would see stale state that doesn't reflect the in-flight work. Fix
  cost nothing (one extra transition call before the Agent call), so
  there is no reason to defer it to "verify afterward."
- **When delegating more than one ticket's work in parallel (within the
  WIP limit), each parallel delegation MUST run in an isolated git
  worktree (Agent tool `isolation: "worktree"`).** A shared working
  directory causes git checkout races between concurrent subagents —
  observed failure mode: one subagent's uncommitted changes silently
  overwritten by another subagent's branch checkout in the same tree.
- After a parallel delegation's ticket reaches Done (merged) or is
  abandoned, remove its worktree (`git worktree remove <path>`) —
  don't leave stale worktrees accumulating on disk.
- **Git worktree isolation does NOT isolate a shared Python virtualenv/
  interpreter.** When multiple developer/tester subagents run in
  parallel worktrees against the same project, `pip install -e ".[dev]"`
  in one worktree repoints the *shared* global interpreter's editable
  install to that worktree's code — a sibling subagent's `pytest` run
  can then silently execute against the wrong worktree's source,
  producing false pass/fail results that have nothing to do with the
  actual code in front of it. Observed in an earlier pilot: two
  parallel developer subagents each
  independently hit and self-diagnosed this. **Mitigation, not a full
  fix**: instruct every parallel subagent to re-run
  `pip install -e ".[dev]"` immediately before its *final* verification
  test run (not just once at the start), and instruct the orchestrator
  to do the same before independently re-verifying a branch in the
  shared checkout. This does not eliminate the race (a subagent can
  still install over you mid-run) — treat any single failing test run
  with suspicion if the failure isn't obviously related to the diff,
  and rerun after a fresh `pip install -e` before trusting a "FAIL".
  A per-worktree virtualenv would remove this class of failure
  entirely; until this project has one, this is a known sharp edge.
- **Git worktree isolation does NOT isolate Playwright's local e2e
  servers either.** `playwright.config.ts` starts the frontend on a
  fixed port and the backend on its own fixed port, both with
  `reuseExistingServer: !process.env.CI`. Locally (no `CI` env), a
  second `npx playwright test` started in another worktree while the
  first is still running silently reuses the FIRST worktree's server —
  it tests the other branch's frontend and reports pass/fail for code it
  never loaded, with no error. Observed in an earlier pilot: two
  parallel developer
  subagents each ran the full e2e suite at the same time; one run
  demonstrably served its own branch, the other's "70/70 passed" could
  not be attributed to any branch and had to be discarded. **Rule:**
  (1) never let two worktrees run e2e at the same time — when parallel
  tickets reach a step that runs Playwright (developer self-check,
  tester, orchestrator re-verification), serialize those steps; (2)
  always run e2e as `CI=1 npx playwright test --workers=1` in
  delegation prompts and in your own verification, so a port collision
  fails loudly instead of reusing a foreign server; (3) if an e2e result
  was produced while another worktree may have been running e2e, treat
  it as unverified and rerun before writing it into a Jira comment.
- **Sequential (one-ticket-at-a-time) delegation still needs care in
  the shared checkout — it is not exempt from git-state races.** Two
  confirmed failure modes from this framework's pilot, neither
  requiring parallel delegation: (1) the orchestrator doing its own
  housekeeping — switching branches, or writing a file like
  `metrics/events.jsonl` — in the shared checkout while a single
  developer/tester subagent is active there; that subagent's own `git
  checkout -b ...` is not guaranteed to preserve unrelated uncommitted
  changes sitting in the tree, and once silently discarded they cannot
  be recovered except by reconstructing from session context. (2)
  Launching a *second* subagent — even a read-only one, even on a
  different ticket — against the same shared checkout while a first
  subagent is active; the second subagent's Read/Grep has no isolation
  from the first subagent's checked-out branch and can report its
  mid-flight, not-yet-merged files as "already in main." **Rule:**
  commit-and-push (or `git stash` under a named stash) any uncommitted
  change in the shared checkout immediately, before delegating a
  subagent that will do its own checkout there — do not batch pending
  writes "to commit later" across a delegation boundary. Do not run
  orchestrator git ops or launch a second subagent against a checkout
  another subagent currently has checked out. Never trust a subagent's
  claim about what's "in main" without independently verifying (`git
  show main:<path>`).
- **Before delegating any subagent with no Bash tool (e.g. reviewer)
  whose task depends on repository file state, `git checkout
  <target-branch>` in the shared working directory yourself as the
  last step before the delegation call.** Such a subagent cannot check
  out a branch itself; it only reads whatever the working directory
  already has checked out. Never assume "it's probably still on the
  right branch from the last thing I did" — after any prior git op
  (including a metrics commit), the working directory may be back on
  `main`. If a read-only subagent reports it cannot verify the PR or
  that the code doesn't match what was described, treat that as a
  signal to check the current branch, not as the subagent being
  unhelpful.
- **Never let "only frontend files changed" (or the backend equivalent)
  be grounds for a developer/tester/reviewer to skip the full test
  suite.** Require both `pytest -q` and `npm run test` (or the
  project's declared equivalents) to actually run and be reported
  green before accepting a stage as complete — "no files on that side
  changed" is not evidence of "tests on that side still pass";
  cross-file consistency tests (e.g. asserting two artifacts stay
  byte-identical) can live on the side that wasn't touched and fail
  precisely because the other side was.
- **A subagent that "appends" or "adds a section" to an existing file
  (reporter on `docs/PRD.md`, architect, etc.) can silently rewrite the
  whole file and drop existing content — its own success report will
  not tell you.** In an earlier pilot a reporter was asked to append two
  sections to the end of the PRD; it reported success, but the file had
  shrunk by roughly 270 lines (`git diff --numstat`: 189 added / 457
  deleted) and earlier stories' sections were gone. Caught only because
  the orchestrator checked the diff before committing. **Rule:** (1) in
  the delegation prompt, say "append only; do not modify, reorder, or
  rewrite any existing content" and name the single file it may touch;
  (2) before committing any subagent's edit to an existing file, run
  `git diff --numstat <file>` and require the deleted-lines count to be
  0 (or exactly what the task intended) — a nonzero surprise means
  stop, don't commit; (3) recovery: save the newly written text aside,
  `git checkout -- <file>`, then re-append it yourself and re-check that
  the numstat shows no deletions; (4) after an architect/developer
  delegation, `git status --short` must show only the file(s) the task
  named. Rule 4c's file-path checklist does not catch this, because the
  PRD is an allowed self-merge path — the damage would have merged
  unreviewed.

## Escalation

3 consecutive failures of the same ticket in the same stage →
follow models.yaml `escalation` exactly. Never retry indefinitely.

## Session wrap-up

When limits.yaml wrap-up conditions hit or no work remains:
flush all state to Jira → emit `session_end` event → produce session
report using templates/session-report.md → end. A dead session must
always be recoverable from the board alone.

## Language

Reports and ticket comments to the human: Traditional Chinese (繁體中文).
Code, commits, branch names, PR descriptions, config: English.

When writing Traditional Chinese into a Jira field, prefer passing
literal UTF-8 text over hand-typed `\uXXXX` escapes. A single-digit
escape typo silently produces a different-but-valid CJK character —
the JSON is well-formed and the API call succeeds, so nothing errors;
the mistake only surfaces if a human happens to read the rendered
text closely. If escapes are unavoidable, re-read the field immediately
after writing and visually check the CJK characters before moving on.

A second, distinct source of the same symptom: text a subagent hands back
(e.g. requirements-analyst's drafted spec) can itself contain stray
Simplified-variant characters or an outright wrong-but-valid character
mixed into otherwise-Traditional prose, even though no `\uXXXX` escape
was involved anywhere in the pipeline. One observed case flipped the
meaning of a sentence (「請另開工單」became「請別開工單」— "please open a
separate ticket" became "please do NOT open a ticket"). Before pasting a
subagent's drafted CJK text into any Jira field verbatim, visually
proofread it end-to-end for this class of error — do not treat "the
subagent said it's finalized" as proof the text is clean.

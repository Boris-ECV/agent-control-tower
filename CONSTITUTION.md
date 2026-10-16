# CONSTITUTION - Agent Control Tower

<!--
Durable engineering principles for this project. Read by
requirements-analyst / architect / reviewer (see their agent docs'
step "0."). Purpose: narrow judgment calls that would otherwise be
re-decided from scratch on every story, so similar situations get
similar answers across the codebase. This does NOT remove the
disclosure requirement - a judgment call guided by a principle here
must still be stated explicitly in the spec/design/review output, not
silently applied.

Keep this short and stable. Add a principle only after it has come up
as a real judgment call more than once; don't pre-populate hypothetical
rules. Every principle below was learned from the data work that
preceded this repository, not invented in advance.
-->

## Public repository (Repository hygiene)

- This repository is PUBLIC. Never commit: host names, IP addresses or
  URLs of any deployed environment; SSH keys, tokens, passwords or other
  credentials; customer or company names; the Jira site name or cloud id.
  Environment-specific values come from environment variables that have
  no default in the code (a missing value is an error, not a fallback).
- Example data must be obviously fictional (names, plants, amounts).
- A secret that reached a commit is compromised even after the commit is
  removed: say so in the ticket and treat the credential as burned.

## Failure handling

- The observability backend is an external dependency. A failed call must
  surface as an explicit error with the endpoint and status, never as an
  empty or zero result: a missing number looks identical to "no cost".
- Never fall back to a default value for a required environment variable.
- Write operations against the backend (data generation, deletion) must
  refuse to run when the target already contains data, unless the caller
  passes an explicit force flag.

## Data correctness (the numbers on screen)

- Every number shown to a user must be reconcilable to a source: either a
  generator manifest or a backend query. A figure that cannot be traced is
  a defect, not a presentation choice.
- All cost, count and trend queries MUST pass explicit project ids. A
  query without a project filter silently aggregates every project,
  including ones that were deleted but whose data the backend keeps.
- Daily buckets and "today" are UTC. Convert to a display time zone only
  at the presentation layer.
- Cost is derived from model, provider and token usage; a missing field
  yields a null cost, which must be shown as "unknown", never as 0.
- Pin the observability backend's version. Its "private" API paths are
  not a stability promise; upgrading is a deliberate, tested change.

## Security defaults

- Deny-by-default for anything that mutates infrastructure: servers,
  volumes, firewall rules, credentials. Those actions are performed by a
  human and tracked as tickets labelled needs-human-gate.
- No new network exposure without a ticket: the backend must not become
  reachable from the public internet except through the reviewed entry
  point.
- Never log request bodies that may contain user data.

## Testing philosophy

- Tests assert behavior, not implementation structure. Deterministic
  generators are tested by running them twice and comparing results.
- Every acceptance criterion maps to at least one automated test; a skip
  placeholder does not count.
- Tests that need a live backend are skipped unless OPIK_BASE_URL is set
  and never run in CI.
- Layout assertions must be platform- and font-independent.

## Scope discipline

- Implement only what the spec requires. Anything you can see will be
  needed later but the current story does not ask for is left for a
  future story.
- When a requirement is ambiguous, raise a HUMAN-INPUT ticket instead of
  guessing, even if the guess looks obvious.
- Design docs stay in proportion to the story: a small change gets a
  short design.

## Code style

- Follow the conventions already present in the code (naming, error
  handling shape, layout) over personal preference; introduce a new
  pattern only when the existing one clearly does not fit, and say why in
  the PR.
- Prefer three similar lines over a premature abstraction.
- Code, identifiers, commits, branch names and PR descriptions are in
  English. Reports and ticket comments to the human are in Traditional
  Chinese.
- Comments explain why, not what.

## Visual design

- For any story that adds or changes UI, the visual decisions come from
  docs/design-system.md. That document is still a skeleton: the first UI
  story must fill it in (palette, type, spacing, components) before
  implementation starts, and every later UI story follows it.

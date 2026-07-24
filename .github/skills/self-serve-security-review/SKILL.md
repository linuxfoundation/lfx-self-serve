---
name: self-serve-security-review
description: >
  Security review for lfx-self-serve (LFX One) pull requests. Use when a PR
  touches the auth middleware or route classification, the OIDC session or
  token-exchange paths, a server controller or service, a proxy call to an
  upstream microservice, the public surface, user identity, impersonation or
  persona-based authorization, PII or logging, URL handling or redirects,
  anything rendered with `[innerHTML]`, or what crosses the SSR-to-client
  boundary. Applies a diff-aware, high-confidence, low-false-positive
  methodology (adapted from Anthropic's claude-code-security-review) to this
  application's durable threat anchors. Discovers the concrete guards from the
  code at review time; this skill carries the method, not an inventory.
---

<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Self Serve Security Review

LFX One is the **authenticated front door** for every persona. It holds the
user's OIDC session and brokers every business request to the microservice mesh
**with that user's identity and bearer token**, and it exposes a deliberately
**public surface** — the data-bearing `/meetings/` join pages and `/public/api`,
plus `/docs`, health, and a few non-data utility routes; `auth.middleware.ts`
is the authoritative route inventory, so verify a route's class there before
calling a public route a regression. So the
failure modes that matter here are a cross-user or cross-persona **authorization
bypass**, a **session or token leak**, **member PII exposure**, and anything that
lets an **anonymous caller** reach more than the public surface intends. Those
facts set the stakes for every security judgment.

## Methodology

Run a focused, **diff-aware** review, not a whole-repo audit:

1. **Only new risk.** Assess what this PR introduces or weakens. Do not
   relitigate pre-existing issues the diff does not touch.
2. **Assume hostile input, report only what is real.** Flag only high-confidence,
   concretely exploitable findings: if you cannot trace a path from an
   attacker-controlled input (a request param, body, header, cookie, the
   `returnTo` URL, user- or project-supplied content) to a sensitive sink, it is
   not a reportable security finding.
3. **Three passes.**
   - *Context*: discover, from the code and the repo docs at review time, the
     guards this application relies on around the diff (the route's auth class,
     the effective-identity helpers, `validateAndSanitizeUrl` / `fetchSafeUrl`,
     the logger's redaction, Angular's default sanitizer, `constantTimeEquals`).
     Never assume a guard exists; find it.
   - *Comparative*: does the change deviate from the guard patterns the
     surrounding code establishes? `docs/reviews/knowledge-base/security.md`
     records the patterns this repo has been bitten by — use it as a checklist of
     known shapes, not a substitute for tracing the actual path.
   - *Assessment*: trace each input to its sink and confirm a guard sits on the
     path the data actually takes, not three functions away.
4. **Confidence-gate every finding** (1-10, report only >= 8, matching the
   reviewer skill's >=80% gate). A few real findings beat a speculative list.
5. **Evidence, not vibes.** Each finding names the file and function, what the
   attacker controls, the boundary crossed, the concrete impact, and the fix.

## Per-fact data-exposure pass

When the diff adds or changes a field on a response payload or a rendered view,
or adds a new read or write path, run this structured pass on top of the
methodology above:

1. **Fact inventory.** For every field the diff adds or changes on a payload or
   view, record its grain (per-person, per-object, aggregate), whose data it is,
   and whether it is PII (name, email, identity, address, financial, or
   otherwise sensitive).
2. **Gate of record, per fact.** For each protected fact, find *which code path
   actually enforces access* — the route's class in `auth.middleware.ts`,
   `requireExecutiveDirector`, the writer flag, an in-app ownership check, or an
   access check enforced upstream behind the proxy — not what the PR body
   claims. If no code enforces it, say so.
3. **Sibling-path parity.** Find the equivalent read or write path elsewhere in
   the repo for the same or an analogous entity (the list endpoint vs. the
   single-get, the live handler vs. a new archived/past-object handler, the
   authenticated page vs. its public twin) and compare enforcement level
   path-by-path. A newer, less-traveled path that is weaker than its sibling —
   same data, lower gate — is the single highest-value finding this pass exists
   to catch.
4. **Verdict per fact.** Enforced and matching sibling parity; a gap (no
   enforcement, or weaker than a sibling path serving the same data); or
   unverifiable here because enforcement lives in an upstream microservice you
   cannot read — name the service and report the guard as asserted, not
   confirmed.

Skip this pass only when the diff adds no field to a payload or view and no new
or changed read/write path (a pure refactor, style-only, or build-tooling
change).

## Durable threat anchors

These are the kinds of boundaries that make a diff security-relevant in this
application. They describe its shape, not its current line-level guards; verify
the concrete mechanism in the code each time.

- **Secrets in the diff.** Grep the diff itself for hardcoded credentials — API
  keys, bearer or M2M tokens, passwords, connection strings, private keys —
  including in test fixtures, e2e configs, and workflow files. A committed
  secret is always a finding, even when the code path that reads it is dead.
- **User token vs M2M token.** The single most important rule here, documented in
  `.claude/rules/development-rules.md`. Endpoints must act with the authenticated
  user's bearer token; an M2M token is the *application's* identity and erases
  user identity, per-user authorization, and the audit trail. M2M is legitimate
  only on the public surface (no user session) or for an explicit privileged
  upstream call from an already-authorized route, scoped to that one call, with
  the user's token/context restored immediately after. Flag: an M2M token on a
  new or existing `/api` route to do normal work, M2M used to skip a per-user
  authorization check, an M2M call whose scope is wider than the one upstream
  request that needs it, or a privileged call that never restores the user
  context.
- **The route classification (selective auth).** `auth.middleware.ts` maps each
  route to `public` / `optional` / `required` (and whether a token is required).
  This mapping *is* the public-vs-protected boundary. Flag: a new route that
  lands on the catch-all with the wrong class, a route moved from `required` to
  `optional`/`public`, a pattern that is unanchored or ordered so a protected
  path matches a more permissive rule first (fail-open), a **new
  unauthenticated route outside the documented public surface**, or a
  `/public/api` endpoint that fails the visibility-filter-before-pagination
  requirement — those are top-scale. A new, correctly filtered `/public/api`
  endpoint is deliberate public surface: scrutinize it with the per-fact
  data-exposure pass rather than flagging it for existing.
- **Identity and impersonation.** Whenever the code means *the acting
  subject*, identity must come from the effective-identity helpers
  (`getEffectiveEmail`, `getEffectiveUsername`, …), not from
  `req.oidc.user.*` directly: impersonation lets an admin/ED act as another
  user, and reading the raw OIDC identity there bypasses that context and
  mis-attributes the action. A deliberate read of the real session actor is
  legitimate where the actor is the point — the impersonation machinery
  recording who the impersonator is (`impersonation.service.ts`), or an audit
  of the real caller. Flag a raw read used as the effective subject, or any
  path that lets the impersonation session be set or widened without the
  established check.
- **Persona-based authorization is server-verified.** The persona cookie is
  unsigned and client-spoofable; it seeds the UI only. A real access decision
  (ED-only routes, writer/edit permission) must be verified server-side
  (`requireExecutiveDirector` via persona detection, the writer flag from
  upstream FGA). Trusting the cookie or a client-side guard for an actual
  authorization gate is a bypass; client guards are UX, not security.
- **Sessions and tokens.** The OIDC session, the refresh and audience-scoped
  token exchanges (`exchangeRefreshTokenForAudience`, the API-gateway and
  crowdfunding tokens), and the M2M token cache. Flag a token minted for the
  wrong audience, a bearer or refresh token written to a log/response/error, a
  token forwarded to an endpoint it was not scoped for, or a weakened
  session/refresh check.
- **Errors and information disclosure.** Errors reach the client through the
  custom error classes' controlled `toResponse()`; stack traces are emitted only
  in dev/debug (`error-serializer.ts`). Flag a new error path that returns a stack
  trace, an internal/upstream detail, a filesystem path, or an identity signal
  (e.g. "user exists") to an unauthenticated caller.
- **URLs, redirects, and SSRF.** These guards are sink-specific — match the
  finding to the right one. Server-side redirect targets (the `returnTo` URL,
  cookie-domain checks) pass `validateAndSanitizeUrl`; server-side fetches of a
  user-controlled URL go through `fetchSafeUrl` (scheme allowlist, private-IP
  blocklist, post-DNS re-resolution against rebinding, redirect cap); a
  user-supplied link normalized for client rendering uses the shared
  `normalizeToUrl` (HTTP(S)-scheme validation, `packages/shared/src/utils/url.utils.ts`)
  — do not demand the server redirect helper on Angular link handling. Flag a
  server redirect built from untrusted input without `validateAndSanitizeUrl`, a
  `fetch`/HTTP call to a user-controlled host that bypasses `fetchSafeUrl`, a
  non-`http(s)` scheme reaching a sink, or a missing `encodeURIComponent` on a
  value interpolated into a URL.
- **Client-side XSS.** Angular's default sanitizer strips `<script>` from
  `[innerHTML]`, so the real risk is `DomSanitizer.bypassSecurityTrustHtml`
  (or `bypassSecurityTrustResourceUrl`) applied to user- or project-supplied
  content, or such content flowing into a code path where a bypass already lives.
  Flag those; flag `window.open`/`target="_blank"` without `rel="noopener"` on an
  untrusted URL. Prefer text interpolation or a sanitizing pipe.
- **PII and logging.** Recipient/member emails and names are PII. The Pino logger
  redacts configured paths and `LoggerService` offers sanitization; flag a new
  log line or error that emits a raw email/name/token, metadata logged without
  sanitization, or a response that exposes PII to a caller not authorized for
  that fact — the per-fact pass above decides that; an authorized caller
  legitimately receiving a member's name, or their own profile, is not a leak.
  Logging non-PII identifiers and URLs is fine.
- **Secrets across the SSR boundary.** Server-only secrets and config (API keys,
  client secrets, M2M credentials) must never cross into the client bundle —
  through a provider, a `TransferState` payload, an Angular environment, or
  runtime config that ships to the browser. Only deliberately public runtime
  config may reach the client. Flag a server secret newly exposed to the client.
- **Public-data visibility.** A `/public/api` endpoint returning meeting/event or
  project data must filter to public visibility **before** paginating, so an
  anonymous caller cannot page into private records. Flag a public read whose
  visibility filter is missing or applied after the page bound.

## What not to flag

Signal discipline keeps the reviewer trusted. Do not raise:

- Denial of service, resource exhaustion, or "add rate limiting" on their own.
  (The repo already tiers rate limits; an *unauthenticated* write with no
  integrity guard is flagged as authorization/data integrity, not load.)
- Mere lack of hardening or defense-in-depth with no concrete vulnerability.
- Outdated third-party dependencies (managed separately); a *new* dependency's
  risk belongs to the architecture lens.
- Theoretical race or timing issues with no practical exploit.
- Test-only files, Markdown, and docs — except a committed secret or
  credential, which is a finding anywhere (see the secrets anchor above).
- Log spoofing, regex-DoS, and missing audit logs.
- SSRF that only controls a path; it counts when the attacker controls host or
  protocol.

Unguessability is not authorization, in either direction: an authorization
finding rests on a missing server-side check, never on whether an id can be
guessed — but identifier *format* validation against the upstream contract
remains a legitimate code-review concern (the knowledge base's
`regex-too-loose-for-id-format` pattern) and is not suppressed by this rule.
Precedents recorded in `docs/reviews/knowledge-base/known-false-positives.md`:
environment variables and runtime config read server-side are trusted inputs;
logging URLs and non-PII is fine; a client-side guard absent server enforcement
is a UX gap, not a vuln, unless the server check is *also* missing.

## Reporting

For each finding give the file and function, what the attacker controls, the
boundary crossed, the concrete impact on this application (which persona, whose
data, what an anonymous caller gains), and the fix. If the diff does not touch an
anchor above, do not invent a finding for it.

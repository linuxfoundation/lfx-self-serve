// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Configuration for the shared Valkey cache (cross-instance, TTL read-through; fail-soft, fail-closed on missing identity). */
export const VALKEY_CACHE = {
  /** App-level key prefix so entries never collide with other consumers of the shared backend. */
  APP_PREFIX: 'lfx-ui',

  /** Domain + completeness-version segment for the org membership resolver cache. `v2`: only complete scans may populate this namespace, so strict readers never consume partial arrays cached by older pods. */
  ORG_MEMBERSHIP_NAMESPACE: 'org-membership:v2',

  /** Domain + schema-version segment for the org access / role-grants cache. `v2`: `resolved` now carries connected-component (upward + cascading) roles alongside the required `degraded` completeness flag, so no entry written by the direct/downward-only resolver can be read back under the new semantics. */
  ORG_ACCESS_NAMESPACE: 'org-access:v2',

  /** Domain + schema-version segment for the per-org Snowflake-backed Org Lens cache (shared across callers). */
  ORG_LENS_SNOWFLAKE_NAMESPACE: 'org-lens-sf:v1',

  /** Domain + schema-version segment for the per-committee Snowflake-backed engagement cache (shared across callers). `v2`: the cached row shape changed from an email-keyed, single-window row to a uid-keyed row carrying all three windows — bumped so no entry written under the old shape can be read back as the new one. */
  COMMITTEE_ENGAGEMENT_NAMESPACE: 'committee-engagement-sf:v2',

  /** Domain + schema-version segment for the per-user org seats cache. `v2` (GH-1906): the stored value is the compact `CompactOrgSeatsEntry` envelope — committees deduped into a dictionary, `organization_id` hoisted, the rest columnar — not a plain seat array, so no `v1` entry can be decoded under the new shape. */
  ORG_SEATS_NAMESPACE: 'org-seats:v2',

  /**
   * Domain + schema-version segment for the per-org Org Lens Groups aggregate (GH-1809), shared
   * across callers rather than per-user. What is stored is the *aggregate the page renders* —
   * committee name, category, foundation, count — not the seat roster it derives from. The roster
   * is large (before GH-1906's compaction it exceeded `MAX_VALUE_BYTES` for larger orgs and was
   * never retained), it is permission-filtered and so can only be cached per caller, and its
   * per-caller entry lives 30 seconds. The aggregate is small, carries no per-caller filtering, and
   * is kept for 15 minutes with explicit invalidation on seat reassignment, which is what makes this
   * page cacheable across callers. The value carries no PII, and it is served only to callers holding a resolved
   * per-org grant — see `assertOrgLensRead`'s returned qualification. Because every such caller gets
   * the same value, it names only foundations confirmed public at fill time (`project_name` is
   * omitted otherwise).
   * `v2` (#3109): `v1` entries could carry a private foundation name read under whichever caller's
   * token filled them, so none of them may be read back.
   * `v3`: `v2` fills took visibility from the per-pod public-name cache (up to 5 min stale), so a
   * `v2` entry may name a project that had already turned private; `v3` fills confirm it fresh.
   */
  ORG_LENS_GROUPS_NAMESPACE: 'org-lens-groups:v3',

  /** Domain + schema-version segment for the per-user org People key-contacts cache. */
  ORG_PEOPLE_KC_NAMESPACE: 'org-people-kc:v1',

  /** Domain + schema-version segment for the per-user org access-list cache. */
  ORG_ACCESS_LIST_NAMESPACE: 'org-access-list:v1',

  /**
   * Domain + schema-version segment for the per-user org People directory cache. Each entry is keyed by
   * one scope — `roster` (the unranged ORG_PEOPLE_ALL roster the reassign pickers read) or
   * `{range}:{projectScope}` — placed before the principal, so the redacted key and the cache family stay
   * `org-people-dir:v7`. `v2`: merge-only fields are stripped before the write and the validator asserts
   * their absence. `v3` (GH-1906): `rows` are stored columnar. `v4` (lfx-self-serve#4163): keyed by time
   * range. `v5` (lfx-self-serve#4164): keyed by project scope too, rows carry every code count and no tiles
   * are stored — the commit scope and metric pick the count after the read. A write that invalidates the
   * directory clears every scope. `v6` (lfx-self-serve#4378): a ranged row carries `isFormer` for an
   * access-only principal who is a former employee in that range, so the current view never lists them.
   * `v7` (#4401): rows carry `keyContactRoles`. The shape guard already rejects a `v6` entry, but sharing
   * one key space across a rolling deploy would have old and new pods each reject and overwrite the
   * other's entry, so the directory mostly misses until the rollout ends.
   */
  ORG_PEOPLE_DIRECTORY_NAMESPACE: 'org-people-dir:v7',

  /** Domain + schema-version segment for the express-openid-connect session store (server-side session data keyed by opaque session id). */
  SESSION_NAMESPACE: 'session:v1',

  /** Domain + schema-version segment for Gatewaze host-session records (#2738): the encrypted GoTrue session keyed by an HMAC of the LFX session id, plus the `@gatewaze/host-session` store's locks, sign-out markers and sign-out channel. A separate record rather than a field on `req.appSession`, for the same blind-overwrite reason as `AUTH_STATE_NAMESPACE`, and because GoTrue rotates refresh tokens. */
  GATEWAZE_HOST_SESSION_NAMESPACE: 'gatewaze:v1',

  /** Domain + schema-version segment for Flow C's (profile Auth0 Management API) CSRF state nonce, keyed by the nonce itself rather than by user or session — see #1938. Kept out of `req.appSession` because express-openid-connect blind-overwrites the whole session on every response; a concurrent request finishing after `/auth/start` silently drops the nonce it wrote. */
  AUTH_STATE_NAMESPACE: 'auth-state:v1',

  /** Private callback support drafts, keyed by a digest of subject and random attempt handle. */
  EMAIL_LINKED_SUPPORT_NAMESPACE: 'email-linked-support:v1',
  EMAIL_LINKED_SUPPORT_TTL_SECONDS: 300,
  /** Upper expiry sanity-check allowance between pods; never extends the Valkey TTL. */
  EMAIL_LINKED_SUPPORT_CLOCK_SKEW_MS: 30000,

  /** Domain + schema-version segment for the per-user meeting-invite-email lock (LFXV2 #2241) — serializes `rejectIdentity`'s guard-then-unlink sequence against a concurrent `setMeetingInviteEmail` for the same user. */
  MEETING_INVITE_LOCK_NAMESPACE: 'meeting-invite-lock:v1',

  /**
   * TTL (ms) for `rejectIdentity`'s side of the per-user meeting-invite-email lock (LFXV2 #2241).
   * Its locked region chains `getMeetingInviteEmail` (`NATS_CONFIG.REQUEST_TIMEOUT`, 5s) +
   * `unlinkIdentity` (5s) + the primary-email read (5s). `cdpService.rejectIdentityForUser` runs
   * after the lock is released (#4523): meeting-invite resolution never reads CDP, and that call can
   * wait behind the member's queued reconcile writes. Set with wide margin above that ~15s region so
   * the lock never expires (and gets silently re-acquired by a second request) while this request's
   * own upstream calls are still legitimately in flight. Also acts as the safety-net auto-release
   * window for the in-memory mutex `withMeetingInviteLock` always holds (Valkey layers cross-replica
   * coverage on top when enabled and reachable), so a hung request can't wedge the lock forever.
   *
   * `setPrimaryEmail` also uses it (#3983): its region chains the invite GET, a user-emails read, the
   * invite SET (20s) and the primary-email write — ~35s worst case, well inside this TTL.
   *
   * `setMeetingInviteEmail`'s own worst case is much shorter (bounded by
   * `NATS_CONFIG.MEETING_PREFERENCE_SET_TIMEOUT`, 20s) — it uses the dedicated, shorter
   * `MEETING_INVITE_SET_LOCK_TTL_MS` below instead, so a lost release on that path doesn't force
   * every subsequent meeting-invite set or email deletion for the user to inherit this longer
   * lockout window.
   */
  MEETING_INVITE_LOCK_TTL_MS: 90000,

  /**
   * TTL (ms) for `setMeetingInviteEmail`'s side of the per-user meeting-invite-email lock
   * (LFXV2 #2241). Its locked region isn't just `MEETING_PREFERENCE_SET_TIMEOUT` (20s): `NatsService
   * .request()` awaits `ensureConnection()` first, which can cold-connect for up to
   * `CONNECTION_TIMEOUT` (5s) before the request's own timeout even starts, and the lock-acquire
   * itself can spend up to `LOCK_OP_TIMEOUT_MS` (3s) finding a degraded backend before `fn()` runs.
   * Worst case is 5s + 20s + 3s = 28s — set with real margin above that, not shared with
   * `rejectIdentity`'s much longer `MEETING_INVITE_LOCK_TTL_MS`, so a lost lock-release on this
   * short path can't wedge the user's own subsequent requests for 90s.
   */
  MEETING_INVITE_SET_LOCK_TTL_MS: 35000,

  /** Domain + schema-version segment for the per-user Groups dashboard engagement-stats cache (org-independent — mine semantics only). */
  GROUPS_ENGAGEMENT_NAMESPACE: 'groups-engagement:v1',

  /**
   * Domain + schema-version segment for the per-committee-member v1-id-mapping bridge cache
   * (LFXV2-1705). TODO(LFXV2-2973): remove this namespace once the model carries v2 keys directly
   * (LFXV2-2968) and the bridge is deleted.
   */
  MEMBER_V1_MAPPING_NAMESPACE: 'member-v1-mapping:v1',

  /**
   * Domain + schema-version segment for the per-caller weekly-brief rating cache (LFXV2-3042).
   * This is the live dedup/upsert store only (current vote per brief_uid+revision+username) —
   * not a system of record. The durable analytics signal is the structured `rating_recorded`/
   * `rating_cleared` log events `weekly-brief.service.ts` emits alongside every write, which
   * flow through the existing Pino → CloudWatch pipeline.
   */
  WEEKLY_BRIEF_RATING_NAMESPACE: 'weekly-brief-rating:v1',

  /** Domain + schema-version segment for the per-brief-revision AI-extracted weekly-brief action-items cache (LFXV2-3043). Keyed by brief uid + revision, so a regenerated/re-edited brief naturally misses and re-extracts — no explicit invalidation needed. */
  WEEKLY_BRIEF_ACTION_ITEMS_NAMESPACE: 'weekly-brief-action-items:v1',

  /** Domain + schema-version segment for the per-foundation Snowflake-backed Social Listening cache (filter options + analytics; shared across callers, since the data is foundation-scoped rather than per-user). `v2`: tag options folded to lowercase, author options guarded + newly cached, mentions-count resource added — stale `v1` entries must never be served as the new shapes. */
  SOCIAL_LISTENING_NAMESPACE: 'social-listening-sf:v2',

  /** Domain + schema-version segment for the per-project Project Lens → Participating Organizations cache (summary + list pages; shared across callers, since the rows carry no per-caller data — Org Lens links are resolved per caller, uncached). `v2`: a foundation's own project lists every current member, contributing or not, and the Members count is the full roster — no `v1` entry may be served under the new semantics. */
  PROJECT_PARTICIPATING_ORGS_NAMESPACE: 'project-participating-orgs-sf:v2',

  /** Domain + schema-version segment for the per-viewer organizer attendance summaries on the meetings home feeds. */
  MEETING_ATTENDANCE_NAMESPACE: 'meeting-attendance:v1',

  /** Default freshness window for membership entries (carried over from the prior 30_000 ms memo). */
  ORG_MEMBERSHIP_TTL_SECONDS: 30,

  /** Freshness window for the per-org Snowflake-backed Org Lens cache (1 hour). */
  ORG_LENS_SNOWFLAKE_TTL_SECONDS: 3600,

  /**
   * Freshness window for Org Lens reads that carry a person's name or title (the Events attendee drawer and the People ->
   * Event Attendees rows): 15 minutes, so an upstream erasure leaves the cache well inside the 1-hour erasure target together
   * with the 15-minute lag of `platinum_lfx_one_org_event_participation`. Count-only reads keep the 1-hour window above.
   */
  ORG_LENS_NAMED_TTL_SECONDS: 900,

  /** Freshness window for the per-committee Snowflake-backed engagement cache (1 hour, matching the Org Lens TTL). */
  COMMITTEE_ENGAGEMENT_TTL_SECONDS: 3600,

  /** Short TTL for a genuinely empty (data_available: false) engagement-rows result — a committee the model doesn't cover yet. Much shorter than `COMMITTEE_ENGAGEMENT_TTL_SECONDS` so "no data yet" can't outlive the committee's dbt sync by up to an hour, while still absorbing repeated page loads in the interim. */
  COMMITTEE_ENGAGEMENT_DEGRADE_TTL_SECONDS: 120,

  /** Freshness window for organizer attendance summaries; short so new answers show within a minute. */
  MEETING_ATTENDANCE_TTL_SECONDS: 60,

  /** Freshness window for the per-user Org Lens caches (seats, key-contacts, access-list, people directory). */
  ORG_LENS_PERUSER_TTL_SECONDS: 30,

  /** Domain + schema-version segment for the per-user meetings roll-up scope (GH-5566): the project UIDs under a foundation or parent project that the caller can see. */
  MEETING_ROLLUP_SCOPE_NAMESPACE: 'meeting-rollup-scope:v1',

  /** Freshness window for the meetings roll-up scope. Long enough that one dashboard load (list, counts, paged calendar feeds, Load More) reuses one tree walk and pages against the same scope; short enough that a new sub-project shows up within minutes. */
  MEETING_ROLLUP_SCOPE_TTL_SECONDS: 300,

  /**
   * Freshness window for the Org Lens Groups aggregate (15 minutes). Deliberately shorter than the
   * 1-hour `ORG_LENS_SNOWFLAKE_TTL_SECONDS` the rest of Org Lens uses: this window bounds *upstream*
   * drift only, and a change the admin makes themselves must not hide behind it — a seat reassign
   * discards the entry outright. Deliberately far longer than the ~34s worst-case time to produce
   * the value, so a stored result is always usable well before it expires (the prior 30s per-user
   * window expired at or before the moment it became useful).
   */
  ORG_LENS_GROUPS_TTL_SECONDS: 900,

  /** Freshness window for the Groups dashboard engagement-stats cache — absorbs repeated dashboard refreshes. */
  GROUPS_ENGAGEMENT_TTL_SECONDS: 60,

  /** Freshness window for a successfully-resolved member v1-id mapping (7 days) — these mappings are stable (a person's legacy identity doesn't change), so a long TTL avoids re-hitting NATS for every request. TODO(LFXV2-2973): remove once the bridge is deleted. */
  MEMBER_V1_MAPPING_TTL_SECONDS: 7 * 24 * 60 * 60,

  /** Short negative-cache TTL (1 hour) for a member confirmed to have no v1 mapping — long enough that a large roster of genuinely-unmapped members doesn't hammer NATS on every request, short enough that a mapping added later (e.g. after a backfill) shows up within the hour. Only ever written for a *confirmed* "no mapping" NATS response, never for an indeterminate one (a timed-out or budget-cut-off lookup) — see `v1-mapping-batch.helper.ts`'s `confirmedUnresolved` distinction. TODO(LFXV2-2973): remove once the bridge is deleted. */
  MEMBER_V1_MAPPING_DEGRADE_TTL_SECONDS: 3600,

  /** Freshness window for the per-brief-revision weekly-brief action-items cache — one brief window's worth (7 days), matching the brief's own weekly cadence. */
  WEEKLY_BRIEF_ACTION_ITEMS_TTL_SECONDS: 7 * 24 * 60 * 60,

  /** Freshness window for Social Listening filter-option and mentions-tags caches (30 minutes); the feed model rebuilds hourly. */
  SOCIAL_LISTENING_TTL_SECONDS: 1800,

  /** Governed Social Listening analytics cache (5 minutes); source models refresh hourly. */
  SOCIAL_LISTENING_ANALYTICS_TTL_SECONDS: 300,

  /** Freshness window for the Participating Organizations cache (1 hour, matching Org Lens); the source models rebuild daily. */
  PROJECT_PARTICIPATING_ORGS_TTL_SECONDS: 3600,

  /** Fallback session TTL when express-openid-connect doesn't supply a per-session expiry (matches its `session.absoluteDuration` default of 7 days). Normally the store derives the actual TTL from the session's own `cookie.maxAge` instead. */
  SESSION_FALLBACK_TTL_SECONDS: 7 * 24 * 60 * 60,

  /** Freshness window for a caller's weekly-brief rating (90 days) — long enough to outlive a brief revision's realistic on-screen lifetime; not indefinite, since Valkey here is a dedup cache, not the durable analytics record (see `WEEKLY_BRIEF_RATING_NAMESPACE`). */
  WEEKLY_BRIEF_RATING_TTL_SECONDS: 90 * 24 * 60 * 60,

  /** TTL for a session whose `cookie.maxAge` is present but already non-positive (already past absolute expiry) — expires it out of Valkey immediately instead of handing it the multi-day fallback above. */
  SESSION_EXPIRED_TTL_SECONDS: 1,

  /** TTL for a Flow C auth-state nonce (#1938) — generously bounded for a single OAuth round trip; the only cleanup mechanism for a nonce abandoned mid-flow. */
  AUTH_STATE_TTL_SECONDS: 600,

  /** Per-op cap; a slower cache resolves to a miss so the request fetches directly (well below the ~30s upstream timeout). */
  OP_TIMEOUT_MS: 250,

  /** Per-op cap for the session store (reads, writes, and deletes). Session ops are fail-closed — a timeout forces re-login rather than falling back to a direct fetch — so this is deliberately much larger than the cache's OP_TIMEOUT_MS to absorb the lazy client's cold-connect (TLS handshake) cost on the first op after a pod start, instead of racing that handshake against a cache-tuned budget. */
  SESSION_OP_TIMEOUT_MS: 3000,

  /** Connection timeout for the lazy client (ioredis's own `connectTimeout`) — this is the real ceiling on a cold `.connect()` handshake, independent of any outer per-op `withTimeout()` race. Matches `SESSION_OP_TIMEOUT_MS` so the session store's larger op budget can actually be spent on the handshake instead of being truncated by a shorter internal connect cap. */
  CONNECT_TIMEOUT_MS: 3000,

  /** Per-op cap for the Flow C auth-state record (#1938). Same rationale as `SESSION_OP_TIMEOUT_MS`: this is an authoritative CSRF check, not a cache that can cheaply degrade, so it must survive the lazy client's cold-connect handshake rather than race a cache-tuned budget. */
  AUTH_STATE_OP_TIMEOUT_MS: 3000,

  /** Per-op cap for a lock acquire/release. Like the session store, a lock op is fail-closed-adjacent (a timeout is treated as "backend unavailable", not silently retried), so this matches `SESSION_OP_TIMEOUT_MS` rather than the cache's much tighter `OP_TIMEOUT_MS` — a lock op is a write that must survive the lazy client's cold-connect handshake, not a read that can cheaply degrade to a miss. */
  LOCK_OP_TIMEOUT_MS: 3000,

  /** Cap for the post-`fn()` release attempt made after an `acquireLock` that already came back `unavailable` (LFXV2 #2241) — that call just spent up to `LOCK_OP_TIMEOUT_MS` finding the backend unresponsive, so the release doesn't get another full budget on top of it. The release is best-effort either way (the lock's own `PX` TTL is the real backstop), so a short cap here only trims tail latency on an already-degraded request; it never affects correctness. */
  DEGRADED_LOCK_RELEASE_TIMEOUT_MS: 250,

  /** Skip caching values larger than this (bytes of the serialized JSON) to avoid storing oversized entries. Stays the default for every cache absent from both `MAX_VALUE_BYTES_BY_SUBRESOURCE` and `MAX_VALUE_BYTES_BY_NAMESPACE`. */
  MAX_VALUE_BYTES: 1_048_576,

  /**
   * Per-sub-resource overrides of `MAX_VALUE_BYTES` (GH-1906), keyed by
   * `{namespace}:{subResourceLabel}[:{subResourceVersion}]` — e.g. `org-lens-sf:v1:people-all:v4`.
   * The trailing per-request discriminators a sub-resource may carry (a time range, a param
   * signature, a person key) are deliberately *not* part of the lookup key: one cap covers every
   * variant of a cache, and no identifier can reach this table. See `ValkeyService.maxBytesFor`,
   * which resolves the key and is used by BOTH the write (`setJson`) and read (`parseCachedJson`)
   * size checks — a cap raised on only one of them would write entries that every read rejects.
   *
   * An entry here is a deliberate, measured exception, not a knob: raising a cap means a single
   * Valkey value of that size is worth the memory and the parse cost on every read. Every entry
   * MUST cite the measured compact size it was sized from and the date it was measured, so a later
   * reader can tell a still-justified cap from one whose payload has since shrunk (or grown).
   *
   * Sized at the measured compact maximum × ~1.25, rounded up to a whole MiB, so an org growing a
   * quarter again doesn't silently fall out of the cache. `Readonly` on purpose: these are release
   * decisions, not a runtime knob, and a test that reached in to overwrite one would be changing
   * production behaviour for every later test in the run.
   */
  MAX_VALUE_BYTES_BY_SUBRESOURCE: {
    // Measured 2026-09-24 against prod ANALYTICS.PLATINUM_LFX_ONE: largest compact value 2,050,250
    // bytes for the largest org measured (down from 4,446,040 pre-compaction).
    // This roster compacts least of the five (×2.2) because its rows are mostly long values —
    // names, addresses, photo URLs, foundation-id arrays — rather than repeated column names.
    // `v3` (lfx-self-serve#4163) is read per time range and for the unranged roster, and drops the
    // stats table; `v4` (lfx-self-serve#4164) is also read per project scope and carries three code counts
    // per row. Measured 2026-10-27 on the dev build (lf-dbt#3118) with a SQL size estimate of each
    // columnar value (string lengths + quotes, numbers, foundation arrays, no column names), calibrated
    // against the 2026-09-24 measurement above (the estimate gives 1.94 MB for that 2,050,250-byte
    // value, so compact ≈ estimate × 1.06): largest `all`-range value 4.04 MiB estimated (largest org
    // measured, all projects; 3.29 MiB LF only), ≈ 4.3 MiB compact; the 12-month all-projects view
    // peaks at 1.85 MiB estimated. 4.3 MiB × 1.25 rounds up to 6 MiB. The default view since lfx-self-serve#4694
    // (Past 2 years, all projects), measured 2026-10-29 against prod the same way: 2.00 MiB (1.86 MiB for the
    // largest company; the larger value is a placeholder account).
    // `v6` (lfx-self-serve#4735) leaves the three code counts off ranged rows (counted live from `people-contributors`),
    // each stored as an absent cell, and is one entry for both organization scopes. Measured 2026-10-30 on the
    // lf-dbt#3166 dev build: largest value 4.57 MB (largest org, All time). `v7` (lfx-self-serve#4287) reads training
    // foundation labels from people-list rows only, a few labels fewer at most, and also keys the unranged roster
    // (`v7:roster`, formerly `v4:roster`); the cap carries over. `v8` reads the renamed `IS_ON_PEOPLE_LIST` column, same rows.
    'org-lens-sf:v1:people-all:v9': 6 * 1_048_576,
    // `people-former` is stored as named-key JSON rows (`withOrgCache`, not columnar). `v3` measured 2026-10-27
    // on the dev build (lf-dbt#3118) as the JSON of the cached rows: largest `all`-range value 1,444,402 bytes
    // (largest org measured, 2,707 rows); the top three orgs exceed the 1 MiB default.
    // 1,444,402 × 1.25 = 1,805,503, rounded up to 2 MiB. The Past 2 years all-projects default (lfx-self-serve#4694)
    // peaks at 0.30 MiB (prod, 2026-10-29). `v4` (lfx-self-serve#4735) keeps six identity columns of the same rows, so the
    // cap carries over.
    'org-lens-sf:v1:people-former:v4': 2 * 1_048_576,
    // Measured 2026-10-27 on the dev build (lf-dbt#3118), same SQL size estimate and × 1.06
    // calibration as `people-all:v4`: person × project rows with the person's identity repeated on
    // each. Largest `all`-range value 6.85 MiB estimated (largest org measured), ≈ 7.3 MiB compact; 12
    // accounts exceed 1 MiB there and 5 exceed 3 MiB, and 3 accounts exceed 1 MiB on the 12-month
    // all-projects view (largest 1.21 MiB estimated). 7.3 MiB × 1.25 rounds up to 10 MiB. The Past 2 years
    // all-projects default (lfx-self-serve#4694) peaks at 2.01 MiB (prod, 2026-10-29, same estimate).
    // `v5` (lfx-self-serve#4482) drops the two declared-maintainer flags from each row, so it is no larger than the
    // `v4` measured here; the cap carries over. Maintainer roles are a separate entry (`people-contributors-roles:v2`,
    // per Team members pick; four short ids per role, a few thousand roles at most for the largest org) under the 1 MiB default.
    'org-lens-sf:v1:people-contributors:v5': 10 * 1_048_576,
    // Measured 2026-09-24 against prod ANALYTICS.PLATINUM_LFX_ONE: largest compact value 1,171,283
    // bytes for the largest org measured (down from 5,482,730 pre-compaction). The per-(person,
    // event) grain is irreducible — the tab's stat cards and filters recompute client-side over
    // every detail row — so the remaining excess is real data, not repetition. `v3` (lfx-self-serve#4598) read listed
    // person × event rows of ORG_EVENT_PARTICIPATION per range, attribution and participation. `v4` (lfx-self-serve#5158)
    // reads everyone the selection credits, not only the listable, so it is larger than `v3`. Measured 2026-11-04 on dev
    // data (largest org, 730-day range, all attribution): about 11k rows, roughly 1.1 MB compact, under the 2 MiB cap
    // carried over from `v2`. All-time, all attribution: the largest real org is about 10.7k rows (~0.9 MB by the same SQL
    // estimate); only the 'Individual - No Account' bucket (~81k rows) exceeds the cap, and an over-cap value skips the
    // cache and reads directly. `v5` drops the per-row HAS_COMPANY_EMAIL flag and adds the `verified` attribution (a
    // subset of `all`), so no value is larger than `v4`; the cap carries over. `v6` (lfx-self-serve#5315) reads Self-reported
    // only through dbt's person-level ORG_EVENT_PARTICIPATION_RANGED (still a subset of `all`); same rows otherwise, the cap carries over.
    // `v7` (lfx-self-serve-ops#1441) reads Employee match only, the `verified` rows of `v6`, so no value is larger; the cap carries over.
    // `v8` (lfx-self-serve#5582) keeps only registrations and speaker records made with a company email, a subset of `v7`'s rows,
    // so no value is larger; the cap carries over.
    'org-lens-sf:v1:people-event-attendees:v8': 2 * 1_048_576,
    // `v4` (lfx-self-serve#4159) is read per range over enrollments of any age (lf-dbt#3118 lifted the 12-month cap).
    // Measured 2026-10-27 on the dev build with the same SQL size estimate and × 1.06 calibration as `people-all:v4`:
    // largest value 6,782,106 bytes (largest org measured, All time; the next two 5.39 MB and 3.20 MB). Only All time on those three
    // orgs needs more than 3 MiB: Past 365 days peaks at 0.91 MB, and the Past 2 years default (lfx-self-serve#4694) at
    // 1.94 MiB (prod, 2026-10-29). 6,782,106 × 1.25 = 8,477,633, rounded up
    // to 9 MiB. Same irreducible per-(person, course-or-cert) grain as before (GH-1906). `v6` (lfx-self-serve#4916,
    // #4287) adds one build timestamp per entry and the project id/name, level and format columns to the course
    // dictionary, and drops the foundation and course option rows, which are now built from the details. Learners
    // outside the people list add one (name, certified flag) row each and no detail rows, so the per-course grain
    // stays the people list's, as measured for `v4`; `v9` adds one product-type cell per course dictionary entry
    // and `v10` two integer counts (`formerOnPeopleList`, no keys: a few bytes), both carried over unmeasured like v6-v8 (v8 only
    // drops outside learners already counted through people-list rows). Re-measure it on the
    // largest organization after lf-dbt enables outside learners (rollout step 3).
    'org-lens-sf:v1:people-trainees:v10': 9 * 1_048_576,
    // Training / Trainees shared-view caches (lfx-self-serve#4285), each far under 1 MiB: measured maximum × 1.25 rounds up to
    // 1 MiB (the default's size), and each is an explicit entry so its measurement lives here. Measured 2026-11-03 on
    // the dev build (ANALYTICS_DEV ORG_PEOPLE_TRAINING, All time, no filters, the five largest organizations; the largest has
    // the most person-course pairs: 33,867) as the JSON of the stored value (`JSON.stringify` size from SQL `TO_JSON` rows,
    // each + 1 comma byte), same filtered-pair rules as the BFF; every filter combination is a subset of these.
    // `training-stats:v6`: one object of 13 scalar fields, 366 bytes at most (a fixed shape; no per-org growth).
    'org-lens-sf:v1:training-stats:v6': 1_048_576,
    // `training-filter-options:v1`: five {label, value} lists, per range; All time is the largest: 42.6 KB for the largest
    // course dictionary (319 course names 37.4 KB, 57 projects 3.2 KB, 23 foundations 1.5 KB, 3 levels, 5 formats).
    'org-lens-sf:v1:training-filter-options:v1': 1_048_576,
    // `training-filter-known:v1`: the distinct raw values (trimmed, capped at MAX_ORG_TRAINING_FILTER_VALUE_LENGTH) of the five filters over
    // all of an organization's people-list training rows, kept only to tell a value the organization carries from one it never does. Same
    // class as `training-filter-options:v1` All time (42.6 KB for the largest course dictionary): it holds the same course names, ids and
    // levels and no labels, plus the raw variants of a name, so it is derived from that measurement, not separately measured.
    'org-lens-sf:v1:training-filter-known:v1': 1_048_576,
    // `training-groups:v1`: the whole group set of one (groupBy, tab), with search, sort and paging done in memory. Largest
    // value 68.7 KB (course grouping, Training tab, 272 groups, All time; 12.1 KB for 47 groups on the Certification tab);
    // foundation 3.8 KB (22 groups), project 10.4 KB (55), level 0.7 KB, format 0.6 KB.
    'org-lens-sf:v1:training-groups:v1': 1_048_576,
    // `training-group-employees:v1`: one drawer cell, capped at MAX_ORG_TRAINING_GROUP_EMPLOYEES (500) {contactId, name, jobTitle}
    // rows. Largest value 43.1 KB (about 500 rows at ~85 bytes; the widest group averaged 141 bytes per row, 70.5 KB for 500).
    'org-lens-sf:v1:training-group-employees:v1': 1_048_576,
  } as Readonly<Record<string, number>>,

  /**
   * Per-namespace overrides of `MAX_VALUE_BYTES`, keyed by the code-defined `{domain}:v{N}` cache
   * family (e.g. `org-seats:v2`). For namespaces that carry no code-defined sub-resource — their
   * post-principal segment is data (an org uid, a digest), so `MAX_VALUE_BYTES_BY_SUBRESOURCE` can
   * never address them. A sub-resource entry takes precedence over a namespace entry; see
   * `ValkeyService.maxBytesFor`, used by BOTH the write and read size checks.
   *
   * Same rules as `MAX_VALUE_BYTES_BY_SUBRESOURCE`: every entry is a deliberate, measured exception
   * citing its measured compact size and date, sized at the measured maximum × ~1.25 rounded up to a
   * whole MiB, and `Readonly` because it is a release decision, not a runtime knob.
   */
  MAX_VALUE_BYTES_BY_NAMESPACE: {
    // Measured 2026-09-28 from prod `valkey_set` oversize logs: largest compact per-user seat
    // roster 1,103,412 bytes (The Linux Foundation, 2,725 seats). Refused at the 1 MiB default,
    // so every People Board/Committee/All Employees load re-drained committee-service (~27 s).
    'org-seats:v2': 2 * 1_048_576,
    // Measured 2026-09-28 → 09-29 from prod `valkey_set` oversize logs, after the seat cap shipped:
    // largest compact per-user live directory 1,708,222 bytes (1.63 MiB; 7 refused writes, all over
    // 1.08 MiB). Refused at the 1 MiB default, so every All Employees load re-ran the four-upstream
    // merge. 1.63 MiB × 1.25 rounds up to 3 MiB; 2 MiB would leave under 25% headroom. A reassign
    // evicts the caller's own entry; other callers' entries, and a fill already in flight on another
    // replica, can still serve a pre-reassign roster until the 30 s TTL expires.
    // `v4` (lfx-self-serve#4163) keys the roster by time range (plus the unranged picker roster), `v5`
    // (lfx-self-serve#4164) by project scope too, with three code counts per row. Measured 2026-10-27 on
    // the dev build (lf-dbt#3118) with the same SQL size estimate and × 1.06 calibration as
    // `people-all:v4` (this value holds the same stored rows plus the live-only rows): largest `all`-range
    // value ≈ 4.1 MiB estimated (≈ 4.3 MiB compact), ≈ 1.9 MiB on the 12-month all-projects view, and
    // 2.51 MiB plus the live-only rows on the Past 2 years all-projects default (lfx-self-serve#4694, prod, 2026-10-29).
    // 4.3 MiB × 1.25 rounds up to 6 MiB. `v6` adds one mostly-absent `isFormer` cell per row (~7 bytes), well
    // inside the headroom. `v7` (#4401) adds a short, usually-empty `keyContactRoles` array per row —
    // only the minority of people holding a key-contact role carry any — likewise inside it. The cap is
    // keyed by namespace, so it has to move with each bump or large orgs drop to the 1 MiB default.
    'org-people-dir:v7': 6 * 1_048_576,
  } as Readonly<Record<string, number>>,
} as const;

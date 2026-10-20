# Meeting details V2 — magic-link security and audit requirements

Plan ID **M-02** · issue [#3609](https://github.com/linuxfoundation/lfx-self-serve/issues/3609) · epic [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765)

**Status: Draft — awaiting review by meeting authorization owner.**

A magic link is a shareable URL that lets someone join a meeting without an invitation, a
registrant record or an LFX account. That makes it an access-control feature, so its rules are set
here before U-08 ([#2934](https://github.com/linuxfoundation/lfx-self-serve/issues/2934)) builds the
backend and M-01 ([#3608](https://github.com/linuxfoundation/lfx-self-serve/issues/3608)) builds the
organizer control. FR-052 in [`requirements.md`](requirements.md) blocks M-01 on both.

`ML-##` items are requirements. **MUST** items are recommended defaults that the owner review
confirms or changes. Items marked **Q-n** need a decision from the meeting authorization owner
(see [Open questions](#open-questions)). Code references are to `feat/meeting-details-v2` @
`f4a8111be` and to `lfx-v2-meeting-service` `main` as of 2026-10-20.

## What exists today

| Concern                     | Today                                                                                                                                                                                                                                                                                                               | Gap for magic links                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Bearer credential           | The meeting password. `GET /public/api/meetings/:id` and `POST /public/api/meetings/:id/join-url` accept it from the `x-meeting-password` header or the legacy `?password=` (`getRequestMeetingPassword`), compared in constant time (`validatePassword`, `utils/security.util.ts`)                                 | The password never expires, cannot be revoked without editing the meeting, and its use is not audited |
| Password in the payload     | `GET /public/api/meetings/:id` returns the full `Meeting`, **including `password`**, to anyone it lets in; V1 builds its copy-link and join call from it (`meeting-join.component.ts:555`, `:1371`)                                                                                                                 | A token holder served this payload would gain the permanent password, defeating expiry and revocation |
| Restricted join             | BFF-enforced: `postMeetingJoinUrl` → `restrictedMeetingCheck` matches the caller by username, then email, else 403 `NOT_REGISTERED_FOR_MEETING`                                                                                                                                                                     | No bypass concept anywhere                                                                            |
| Upstream join link          | `get-itx-join-link` (`GET /itx/meetings/{id}/join_link`) takes `email`, `name`, `user_id` and `register` ("register user as guest if not already registered"); returns the Zoom join URL                                                                                                                            | No token parameter; `register` would turn a link use into a permanent registrant                      |
| Upstream token / audit      | None. The meeting service's `internal/service/itx/audit.go` only stamps `created_by` / `updated_by` on writes                                                                                                                                                                                                       | Issue, validate, revoke, storage and an audit trail all need building (U-08)                          |
| Past-meeting access         | `checkPastMeetingAccess` grants `full_access` to a signed-in registrant, **past participant** (matched by email or username) or linked-committee member; artifacts are gated per artifact by FGA `recording_viewer` / `transcript_viewer` / `ai_summary_viewer` (`public`, `meeting_participants`, `meeting_hosts`) | A guest who joins becomes a Zoom participant, which can later read as "participant" (see ML-23)       |
| Precedent for opaque tokens | Invite tokens are HS256 JWTs (`invite.controller.ts`), redacted from logs and RUM by `redactInviteToken` / `redactLoggedUrl`; auth fragments by `redactAuthFragment` (`AUTH_FRAGMENT_KEYS`)                                                                                                                         | A stateless JWT cannot be revoked; magic links need server-side state                                 |

## Token

- **ML-01** The token MUST be opaque: 32 bytes (256 bits) from a CSPRNG, base64url-encoded without
  padding, with a fixed prefix (`lfxml_`) so secret scanners can recognise it. It MUST NOT be a JWT
  or encode the meeting id, expiry or any identity.
- **ML-02** Upstream MUST store only a SHA-256 hash of the token, never the token itself. The
  plaintext is returned once, in the create (or regenerate) response, to the organizer. Copying it
  later means regenerating (Q-4).
- **ML-03** A link MUST be bound to one meeting id. On a recurring meeting it is valid for every
  occurrence inside its expiry, not for one occurrence.
- **ML-04** A meeting MUST have at most one active link. Creating a link while one is active is a
  regenerate (ML-12).
- **ML-05** The URL MUST carry the token in the fragment — `/meetings/:id#ml=<token>` — never in
  the query string or path, so it stays out of server access logs, proxies and `Referer`. The page
  MUST read it after hydration, send it to the BFF in an `x-meeting-link` header, and remove the
  fragment from the address bar (`history.replaceState`).
- **ML-06** `ml` MUST be added to `AUTH_FRAGMENT_KEYS` and `x-meeting-link` to `LOG_CREDENTIAL_KEYS`,
  so RUM and server logs redact it as they redact auth fragments and the meeting passcode today.

## Expiry

- **ML-07** Every link MUST have an `expires_at`. There is no non-expiring link.
- **ML-08** Defaults: a single meeting's link expires when its join window closes (end + 40 min,
  `MEETING_END_BUFFER_MS`). A series link expires 7 days after creation, or at the close of the
  last occurrence's join window if that is sooner.
- **ML-09** Maximum: 30 days after creation, and never after the close of the last occurrence's
  join window. Minimum: 1 hour, unless the meeting's window closes sooner.
- **ML-10** An organizer MAY change `expires_at` within those bounds without changing the token.
  Each change is audited (ML-19).
- **ML-11** Expiry MUST be checked server-side, in UTC, on every request that relies on the token,
  including the join-url call. A page loaded before expiry MUST NOT be able to join after it.

## Revocation

- **ML-12** Revoke MUST take effect for every new request within 60 seconds, across any cache. The
  BFF MUST NOT cache a validation result for longer. Regenerate MUST revoke the old link and issue
  the new one atomically; the old token MUST stop working before the new one is returned.
- **ML-13** A link MUST be revoked automatically when the meeting is deleted, or when its
  `visibility` or `restricted` setting changes (the organizer re-decides under the new rules).
  Auto-revocation is audited with the reason.
- **ML-14** Links belong to the meeting, not to their creator: any organizer can revoke one, and a
  link survives its creator losing the organizer role.
- **ML-15** An invalid, expired and revoked token MUST get the same response, with no oracle
  distinguishing them; the reason is recorded only in the audit trail.
- **ML-16** Revocation stops new join URLs. It cannot recall a Zoom join URL already issued, nor
  remove someone already in the call; the organizer uses Zoom's in-meeting controls for that. The
  M-01 popover MUST say so next to Revoke.

## Use

- **ML-17** A link MUST be multi-use: anyone who holds it may use it until it expires or is revoked.
  Per-person, single-use access already exists as the invitation (a registrant record). There is no
  use cap in the first version.
- **ML-18** A "use" is a successful join-url issuance, not a page view. `use_count` and
  `last_used_at` are shown to organizers only.

## Audit

- **ML-19** Upstream MUST keep a durable audit trail, separate from application logs, with one
  record per event:

  | Event            | Recorded                                                                                                        |
  | ---------------- | --------------------------------------------------------------------------------------------------------------- |
  | `created`        | link id, meeting id, organizer username, `expires_at`                                                           |
  | `expiry_changed` | link id, organizer username, old and new `expires_at`                                                           |
  | `revoked`        | link id, organizer username or `system`, reason (`manual`, `regenerated`, `meeting_changed`, `meeting_deleted`) |
  | `used`           | link id, meeting id, occurrence id, guest-supplied name and email, username when signed in                      |
  | `rejected`       | meeting id, reason (`unknown`, `expired`, `revoked`), link id when known                                        |

  Every record carries a UTC timestamp and the request id. It MUST NOT carry the token or its hash.

- **ML-20** Application logs (pino → Datadog, upstream `slog`) MUST carry only `link_id`,
  `meeting_id`, operation and outcome. Never the token, its hash, the guest's email or name. The
  magic-link path MUST NOT copy today's `post_meeting_link` and `get_public_meeting_by_id` success
  logs, which log `email` in clear (a pre-existing issue, to be fixed in its own PR per FR-053).
- **ML-21** Audit records are readable by organizers of that meeting (their link's history) and by
  platform administrators. Retention: 13 months after the link expires or is revoked, then deleted
  (Q-5).
- **ML-22** Rejected uses MUST be rate-limited per IP on the validation path, in addition to
  `publicApiRateLimiter` (100 / min / IP), and repeated rejections for one meeting SHOULD alert.
  256-bit entropy makes guessing infeasible; the limit protects the audit store and upstream.

## Applicability

| Privacy              | Link offered | Why                                                                                               |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| `public-open`        | no           | Nothing to bypass: anyone can open the page and join (D-1, D-2). The M-01 control does not render |
| `private-open`       | yes          | Replaces handing out the permanent password with an expiring, revocable, audited link             |
| `public-restricted`  | yes (Q-1)    | This is the bypass M-01 exists for: the link holder skips the registrant match                    |
| `private-restricted` | yes (Q-1)    | As above                                                                                          |

## What a magic-link guest can reach

- **ML-23** A valid token grants, on that meeting only:
  - **the upcoming page**: `GET /public/api/meetings/:id` and the occurrences timeline, as the
    password path returns them, **without `password`, `host_key` or any other durable credential**,
    and without registrant counts;
  - **the live join**: `POST /public/api/meetings/:id/join-url` inside the join window, skipping the
    password check and, on a restricted meeting, the registrant match. The upstream call MUST NOT
    register the guest (`register` unset), so a use never creates a registrant record or an FGA
    `participant` tuple.

  It grants **nothing else**. Explicitly:

  | Surface                                  | Magic-link guest                                                                                       |
  | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
  | Live join                                | **yes**, inside the join window                                                                        |
  | Title, time, privacy, agenda             | yes                                                                                                    |
  | Materials (attachments)                  | **no** (Q-2)                                                                                           |
  | Recordings                               | **no**                                                                                                 |
  | Transcripts                              | **no**                                                                                                 |
  | AI summary                               | **no**                                                                                                 |
  | People roster, RSVP, counts              | no                                                                                                     |
  | Host key, join details, meeting password | no                                                                                                     |
  | Past-meeting page                        | only what the viewer gets without the link: the token is not accepted by `/public/api/meetings/past/*` |

- **ML-24** `artifact_visibility` and the per-artifact levels (`recording_access`,
  `transcript_access`, `ai_summary_access`) MUST NOT read a magic-link guest as a participant or
  host. A guest sees an artifact only when its own level is `public` on a public, unrestricted
  meeting (E4-04, `isPastMeetingArtifactPublic`), which any anonymous visitor already sees. No
  `*_viewer` tuple is ever written for a link use.
- **ML-25** Joining through a link MUST NOT later grant past-meeting access as a "past participant"
  (`checkPastMeetingAccess`) or the FGA `attendee` relation. Upstream MUST mark such a join so
  reconciliation can exclude it (Q-3).
- **ML-26** A signed-in viewer's own access always wins. When they are a registrant or organizer,
  the token is ignored (not validated, not counted, no guest banner). A signed-in outsider with a
  valid token is treated as a magic-link guest, and the token adds nothing to what their identity
  already grants.

## Ownership and enforcement

- **ML-27** Issue, validate, revoke, storage and the audit trail belong to `lfx-v2-meeting-service`
  (U-08). The BFF never mints, stores or hashes tokens.
- **ML-28** Create, revoke, regenerate, change expiry and read link metadata require the caller's
  own token and the FGA `v1_meeting#organizer` relation upstream. Hosts who are not organizers and
  registrants cannot manage links (M-01 AC).
- **ML-29** Validation is called by the BFF with the M2M token, because the guest has no session.
  This is a genuinely public endpoint, which `.claude/rules/development-rules.md` allows M2M for.
- **ML-30** Authorization MUST NOT depend on `MEETING_DETAILS_V2_FLAG` (FR-002): the BFF accepts or
  rejects a token the same way whichever page tree the viewer gets.
- **ML-31** Anonymous visitors get V1 until rollout stage 5 (FR-001), and V1 cannot read a token, so
  a guest would land on `/meetings/not-found`. The M-01 control MUST NOT be enabled for organizers
  in production before anonymous traffic reaches V2 (Q-6).

## Proposed contract for U-08

Names, types and nullability for #2934 to confirm before implementation, as its notes require.

| Field          | Type              | Null | Payload                                         |
| -------------- | ----------------- | ---- | ----------------------------------------------- |
| `link_id`      | string (UUID)     | no   | link record; every management response          |
| `meeting_id`   | string            | no   | link record                                     |
| `token`        | string            | —    | create / regenerate response only, never stored |
| `expires_at`   | string (RFC 3339) | no   | link record; create and update request          |
| `created_at`   | string (RFC 3339) | no   | link record                                     |
| `created_by`   | string (username) | no   | link record                                     |
| `revoked_at`   | string (RFC 3339) | yes  | link record                                     |
| `revoked_by`   | string (username) | yes  | link record; `system` for auto-revocation       |
| `use_count`    | integer           | no   | link record                                     |
| `last_used_at` | string (RFC 3339) | yes  | link record                                     |

Operations: create (or regenerate), update `expires_at`, revoke, get the active link (organizer),
validate (M2M; returns `meeting_id`, `link_id` and validity only), and a join-link variant or
parameter that accepts a validated link id and records the `used` event.

## Open questions

For the meeting authorization owner unless stated.

- **Q-1** Do restricted meetings accept a magic link at all? Recommended: yes, organizer-created
  only, because it is the case M-01 is for; the alternative is limiting links to `private-open`.
- **Q-2** Should a link guest see materials on an upcoming meeting, as a password holder does
  today? Recommended: no, until an organizer can choose per link.
- **Q-3** Can upstream mark a link join so that participant reconciliation and the past-meeting
  participant check exclude it (ML-25)? Does ITX's join link enforce restriction itself, or only
  the BFF? If it enforces it, U-08 needs a server-side bypass, not a BFF one.
- **Q-4** Hash-only storage means an organizer cannot copy an existing link later, only regenerate
  it. Acceptable, or store it encrypted so it can be shown again? (Affects the M-01 popover.)
- **Q-5** Is 13 months the right audit retention, given the guest email and name it holds? (Owner
  plus LF privacy.)
- **Q-6** For the project owner, not authorization: ship M-01 only after rollout stage 5, or route
  a token-bearing anonymous arrival to V2 before then?

## Feeds

| Requirement           | U-08 (#2934)                                                  | M-01 (#3608)                                                                     |
| --------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ML-01 – ML-06 token   | Token generation, hash storage, one active link per meeting   | Copy shows the full URL with the fragment; page reads and clears it              |
| ML-07 – ML-11 expiry  | Default and maximum enforced server-side                      | Expiry control limited to the allowed range, defaulting per ML-08                |
| ML-12 – ML-16 revoke  | Revoke, atomic regenerate, auto-revocation, uniform rejection | "Regenerate invalidates the previous link"; Revoke states its Zoom limitation    |
| ML-17 – ML-18 use     | Multi-use, `use_count`, `last_used_at`                        | Usage state in the popover                                                       |
| ML-19 – ML-22 audit   | Audit trail, retention, rate limit, no PII in logs            | BFF logs `link_id` only                                                          |
| Applicability         | Reject create on `public-open`                                | Control hidden on `public-open`                                                  |
| ML-23 – ML-26 reach   | No registrant, no FGA tuple, join marked as link join         | Guest banner as its own page state; no materials, artifacts or roster for guests |
| ML-27 – ML-31 enforce | Organizer-only management, M2M validate                       | Organizer-only control (never hosts-without-organizer); not before ML-31 is met  |
| Whole document        | Field names, types and payloads from the proposed contract    | Tooltip: anyone with the link can join without an invitation or an account       |

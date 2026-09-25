# Meeting details V2 — state matrix

Plan ID **E0-01** · issue [#1766](https://github.com/linuxfoundation/lfx-self-serve/issues/1766) · epic [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765)

Every combination of the page's state axes, whether it is reachable, what V1 renders today, and
what V2 renders. This is the matrix #1766 defers; the `FR-###` requirements are written against it.

> **Sources.** Derived from the Cowork state assessment (`lfx-meeting-details-state-assessment.md`,
> 2026-08-22) and the implementation plan (`meeting-details-redesign-implementation-plan.md`,
> revised 2026-09-23), then **re-verified line by line against `main` @ `1ee353054`
> (2026-09-24)**. Where the two disagree, `main` wins and the row says so. File references are to
> that commit; `V1:` is `modules/meetings/meeting-join/meeting-join.component.*`, `BFF:` is
> `server/controllers/public-meeting.controller.ts`.
>
> **Pending siblings.** `spec.md` (E0-01, PR #2914) and the `resolveActionSlot` resolver
> (E0-02, PR #2909) are not on `main` at the time of writing.

## Axes

| Axis                      | Values                                                                      | Source of truth                                                                                         |
| ------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **A. Time**               | `before` · `live` · `ended`                                                 | `canJoinMeeting` / `hasMeetingEnded` (window: start − `early_join_time_minutes ?? 10` to end + 40 min)  |
| **B. Viewer**             | `visitor` (anonymous) · `outsider` · `registrant` · `organizer`             | session + `meeting.invited` / `meeting.organizer`. **Host = organizer + host key**; not a separate role |
| **C. Privacy**            | `public-open` · `public-restricted` · `private-open` · `private-restricted` | `visibility` × `restricted`; labels from `getMeetingPrivacyLabel`                                       |
| **D. Past access**        | `full` · `none` — meaningful only when A = `ended`                          | `full_access` from `GET /public/api/meetings/past/:id` (`checkPastMeetingAccess`)                       |
| **E. Cadence**            | `series` · `single`                                                         | `meeting.recurrence !== null`                                                                           |
| **F. RSVP tracking**      | `on` · `off` (pre-January-2024 meetings)                                    | normalized `Meeting.is_invite_responses_enabled` — never the raw `use_new_invite_email_address` alias   |
| **G. Arrival credential** | `none` · `password` (`?password=` on the link) · ~~`magic-link`~~           | query string. Magic link is blocked on upstream **U-08** (#2934) and out of scope until it exists       |
| **Page status**           | `loading` · `loaded` · `error` · `not-found`                                | V1's three-way chain (error / page / skeleton) plus the `/meetings/not-found` redirect                  |

Axis **G** is not in the plan's axis list, and it is the one that decides reachability. It is
added here because the verification showed that every "outsider on a restricted meeting" state
the plan designs for is only reachable **with** a password. See [Reachability](#reachability).

## Reachability

A combination is **legal** when the page can actually be in it, and **illegal** when the BFF or
client routes the viewer away first. Illegal combinations are asserted as redirects, never designed
as page states.

### Before and live (the upcoming endpoint)

`GET /public/api/meetings/:id` returns the meeting when any of these holds, in this order
(BFF:148–202):

1. privacy is `public-open`;
2. the caller is `invited` or `organizer`;
3. an authenticated caller matches a registrant by email;
4. `?password=` matches the meeting password.

Otherwise it returns **400 "Invalid password"**, and the client redirects 400/403 to
`/meetings/not-found` (V1 TS:883). A **404** is different: it first falls back to the past-meeting
lookup (V1 TS:862–880), so a plain numeric id of a past meeting still loads, and only a
404 / 403 / 400 from that fallback redirects. So:

| Viewer                 | Privacy       | Credential | Outcome                                  |
| ---------------------- | ------------- | ---------- | ---------------------------------------- |
| any                    | `public-open` | any        | **legal**                                |
| registrant / organizer | any           | any        | **legal**                                |
| visitor / outsider     | not open      | `none`     | **illegal → `/meetings/not-found`**      |
| visitor / outsider     | not open      | `password` | **legal** — this is the invite-link path |

The last row matters most. An invite link carries `?password=`, so **an anonymous invitee on a
restricted meeting is a visitor + restricted + password**, and that is how most invitees without an
LFX session arrive.

### Ended (the past endpoint)

`GET /public/api/meetings/past/:id` has no password path and never 403s on privacy. It always
returns a payload, tiered by `full_access` (helpers/meeting.helper.ts:273–335):

- `full` when privacy is `public-open` (any viewer, anonymous included), the caller is an organizer
  (FGA `v1_past_meeting#organizer`), or an authenticated caller is a registrant, a past
  participant, or a member of a linked committee;
- otherwise `none`, and the payload is trimmed to 19 fields: no description, no occurrences, no
  committees, no counts, no artifacts. The feature toggles survive, so a Recording badge can
  legitimately appear with nothing behind it.

So every ended combination is legal. Anonymous + `full` happens only for `public-open` meetings.

### Other illegal combinations

- **Host without organizer.** Not a distinction the app makes; host key visibility is a property
  of an organizer inside the host-key window (−70 / +40 min), never on a past meeting.
- **Axis D on a non-ended meeting.** `full_access` only exists on the past payload.
- **Axis F × any RSVP state when F = `off`.** F = `off` removes the RSVP dimension; it is not an
  RSVP state.
- **Manage-role viewer of a past meeting on this page.** Per #2251 they are routed to
  `/meetings/:id/details` (the admin surface). This matrix is the View-role experience.

## Action slot

The central table. One row per legal (time, viewer, privacy) group, collapsing cells that behave
identically. Axis E never changes the slot kind; it only adds the RSVP scope modal on `series`.

**V1** is what `main` renders (chain at V1 HTML:387 → 440 → 487 → 507, no terminal else).
**V2** is `resolveActionSlot` in PR #2909, after decisions D-1 to D-4 below. **Status**: `=`
parity · `fix` V2 deliberately repairs a V1 dead end · `D-n` the row a decision settled.

### Before

| Viewer     | Privacy (credential)           | F   | V1                                                            | V2 (#2909)            | Status                     |
| ---------- | ------------------------------ | --- | ------------------------------------------------------------- | --------------------- | -------------------------- |
| visitor    | public-open                    | —   | empty column; guest form below (submit fails until window)    | `register`            | fix                        |
| visitor    | not open (password)            | —   | empty column; guest form below                                | `none`                | =                          |
| outsider   | public-open                    | —   | Register                                                      | `register`            | =                          |
| outsider   | public/private-restricted (pw) | —   | **empty column, no copy**                                     | `invitation-required` | fix                        |
| outsider   | private-open (pw)              | —   | empty column                                                  | `none`                | = (D-3)                    |
| registrant | any                            | on  | RSVP (+ scope modal on series)                                | `rsvp`                | =                          |
| registrant | any                            | off | **empty column** (Register needs `!invited`)                  | `rsvp-unavailable`    | fix (N-01)                 |
| organizer  | any                            | on  | organizer card: RSVP aggregate, Set/Update My RSVP if invited | `rsvp`                | =                          |
| organizer  | any                            | off | organizer card: "N invited" only                              | `none`                | = (count stays in content) |

### Live

| Viewer     | Privacy (credential) | V1                                                                                                                 | V2 (#2909)            | Status  |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------- | ------- |
| visitor    | public-open          | guest form joins                                                                                                   | `guest-join`          | =       |
| visitor    | private-open (pw)    | **guest form joins** — join-url checks the password, not privacy                                                   | `guest-join`          | = (D-1) |
| visitor    | restricted (pw)      | **guest form joins when the email matches a registrant** — the anonymous invitee path                              | `guest-join`          | = (D-1) |
| outsider   | public-open          | **Join** — the Join branch wins for any signed-in viewer; join-url does not require registration when unrestricted | `join`                | = (D-2) |
| outsider   | private-open (pw)    | **Join** (succeeds)                                                                                                | `join`                | = (D-3) |
| outsider   | restricted (pw)      | Join, then `NOT_REGISTERED_FOR_MEETING` error + "use a different email" link                                       | `invitation-required` | fix     |
| registrant | any                  | Join (RSVP not shown — Join branch comes first)                                                                    | `join`                | =       |
| organizer  | any                  | Join                                                                                                               | `join`                | =       |

### Ended

| Viewer                | D      | V1                                                                                                     | V2 (#2909)  | Status                            |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------ | ----------- | --------------------------------- |
| organizer             | any    | Meeting Tools (organizer always has `full` per FGA)                                                    | `tools`     | =                                 |
| outsider / registrant | `full` | Meeting Tools — recording / AI summary (Approved·Pending) / transcript, each with an unavailable state | `tools`     | =                                 |
| outsider / registrant | `none` | no column; amber "This is a private meeting" lock panel; agenda + materials hidden                     | `no-access` | =                                 |
| visitor               | `full` | **no column** — branch D needs `authenticated()`, and every artifact route is `/api/*` (auth required) | `tools`     | D-4 — sign-in variant until E4-04 |
| visitor               | `none` | no column; "Sign in to view meeting details" card; agenda + materials hidden                           | `no-access` | =                                 |

## Decisions (signed off 2026-09-24)

Verification found four places where the first version of `resolveActionSlot` removed something V1
allows. They shared one root cause: it keyed **joining** on `privacy.openToPublic` (public **and**
unrestricted), but in the app only **registration** needs that. Joining needs only `!restricted`
once the page has loaded, because reaching a non-open page already required the password; and on a
restricted meeting the server, not the page, decides, by matching the joiner's email against the
registrants. All four recommendations were accepted; D-1 to D-3 are applied in PR #2909.

- **D-1 — Anonymous viewers in the join window get `guest-join`, whatever the privacy.** On a
  restricted meeting this is how an invitee without an LFX session joins from their invite link;
  the join-url endpoint's registrant-email check enforces the restriction.
- **D-2 — A signed-in outsider on a live public-open meeting gets `join`,** as in V1, not a
  Register step first. Registration is still offered before the window.
- **D-3 — A signed-in outsider on a private-open meeting (they hold the link) gets `join` when
  live and `none` before the window.** "Anyone with the link can join" is the meeting's own
  setting, so `invitation-required` would be wrong; they cannot register, because the BFF only
  registers for public meetings, and the time banner already says when the window opens.
- **D-4 — An anonymous viewer of an ended public-open meeting keeps `tools`.** `full_access` is
  true, but every artifact route requires auth, so E4-01 renders the tools slot's sign-in variant
  until E4-04 ships public artifact routes. No resolver change.

The resolver's live and before branches are therefore:

```text
live:   organizer | registrant → join
        visitor               → guest-join
        outsider              → restricted ? invitation-required : join
before: organizer | registrant → RSVP tracking on ? rsvp : (registrant ? rsvp-unavailable : none)
        visitor               → public-open ? register : none
        outsider              → public-open ? register : restricted ? invitation-required : none
```

## Section visibility

Per viewer, for a `loaded` page. `ended/none` hides the agenda and materials row for everyone,
anonymous included (V1 HTML:585).

| Section                        | visitor          | outsider | registrant | organizer   | Notes                                                                                       |
| ------------------------------ | ---------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------- |
| Header: title, badges, time    | ✅               | ✅       | ✅         | ✅          | single 4-way privacy chip in V2 (E1-04); V1 shows separate Private / Restricted badges      |
| "Organized by"                 | ❌               | ✅       | ✅         | ✅          | `created_by` / `owner` / `organizers` deleted for anonymous (BFF:140–142)                   |
| Agenda                         | ✅               | ✅       | ✅         | ✅          | hidden when `ended/none`                                                                    |
| Materials                      | ❌ sign-in state | ✅       | ✅         | ✅ + Manage | fetch is auth-gated; V1's anonymous copy is wrong on public meetings. Public route is E3-03 |
| People / roster                | ❌               | ❌       | ✅         | ✅          | no count source for non-registrants (GH-1731); hidden when `ended/none`                     |
| RSVP summary, filter, badges   | ❌               | ❌       | F=`on`     | F=`on`      | F=`off` removes all three; invitee count only                                               |
| Join details                   | ❌               | ❌       | ✅         | ✅          | not once the meeting has ended (`joinDetails: !ended && onTheMeeting`)                      |
| Host key (inside join details) | ❌               | ❌       | ❌         | in window   | only inside −70 / +40 min, never on a past meeting                                          |
| Meeting Tools                  | D-4              | `full`   | `full`     | ✅          | per-tool unavailable states; unapproved AI summaries currently shown "Pending"              |
| Occurrence strip               | series           | series   | series     | series      | cancelled occurrences are filtered out silently today; E6-05 designs the state              |

## Page status

| Status      | Trigger                                                                                                                                    | V1                                                  | V2                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------- |
| `loading`   | no payload yet, or `meetingMatchesRoute()` false after in-place navigation                                                                 | skeleton (`meeting-join-skeleton`, `role="status"`) | restyled skeleton (E1-01), same stale-content guard |
| `error`     | any fetch failure other than 400 / 403 / 404; seeded through TransferState (`meetingLoadFailed`)                                           | error block (`meeting-join-error`, `role="alert"`)  | restyled error state (E1-01)                        |
| `not-found` | 400 / 403 on the upcoming lookup; a 404 there falls back to the past lookup, and 404 / 403 / 400 from that fallback (or on a composite id) | redirect to `/meetings/not-found`                   | unchanged — V1's lookup owns it until #2920         |
| `loaded`    | payload for the current route                                                                                                              | the tables above                                    | the tables above                                    |

## Open questions carried from the plan

Not decided here, and each blocks the issue named:

- Unapproved AI summaries: hide them (`isPastMeetingSummaryVisible`) or keep "Pending"? — E4-03
- `artifact_visibility` is authored but enforced nowhere; enforcing it hides some artifacts — E4-04
- `show_meeting_attendees` is enforced nowhere and V1 only toasts "Coming Soon" — E3-04
- Materials "Primary / Supporting" is really file vs link — E3-02
- RSVP alongside Join during the window (V1 has no RSVP there) — E2-01
- How much participant identity a public viewer sees (N-02 tiers) — N-02

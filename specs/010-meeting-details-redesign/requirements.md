# Meeting details V2 — requirements

Plan ID **E0-01** · issue [#1766](https://github.com/linuxfoundation/lfx-self-serve/issues/1766) · epic [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765)

Numbered functional requirements and success criteria for the meeting details redesign. Every
Phase 1 and Phase 2 issue cites at least one `FR-###` (see [Traceability](#traceability)). The
cell-by-cell behaviour each requirement refers to is in [`state-matrix.md`](state-matrix.md); the
rollout invariants `R01`–`R07` are in `spec.md` (E0-01, PR #2914, pending on `main`).

"Viewer", "privacy", "time", "RSVP tracking" and the slot kinds (`join`, `guest-join`, …) are the
axis values and `ActionSlotKind` members defined in the state matrix.

## Functional requirements

### Rollout and page lifecycle

- **FR-001**: V2 MUST render only for a signed-in viewer for whom `MEETING_V2_ENABLED_FLAG`
  evaluates true after hydration. Everyone else, and every anonymous visitor, MUST get V1, and the V1
  component MUST stay byte-identical (R01, R05).
- **FR-002**: The flag MUST gate UI only. No BFF route, response shape or authorization decision may
  depend on it (R02).
- **FR-003**: An unready, erroring or timed-out flag provider MUST render V1 (R03).
- **FR-004**: V2 MUST load as its own lazy chunk that V1 viewers never download, and a failure to
  load that chunk MUST render V1 rather than an empty region.
- **FR-005**: V2 MUST preserve the `MeetingJoinPageState` TransferState contract — key
  `meetingJoinState`, consumed once in the browser, **including the seeded terminal-error branch** —
  and the `meetingMatchesRoute()` stale-content guard, so in-place navigation between meetings shows
  the loading state, never the previous meeting.
- **FR-006**: V2 MUST implement the page statuses: `loading` (restyled skeleton,
  `role="status"`), `error` (restyled error state, `role="alert"`), and `not-found` (redirect to
  `/meetings/not-found`), with the triggers listed in the state matrix. SSR responses MUST keep
  `Cache-Control: private, no-store`.
- **FR-007**: A viewer who is not invited, not an organizer, not matched by email and holds no valid
  `?password=` MUST reach `/meetings/not-found` for any meeting that is not public-open. The same
  viewer holding the password MUST get the page. V2 MUST NOT design an in-page state for the first
  case.

### Header

- **FR-010**: The header MUST render **one** privacy chip whose label and icon come from
  `getMeetingPrivacyLabel` / `getMeetingPrivacyIcon` — four values of one element — and an absent
  `visibility` MUST read as private everywhere on the page.
- **FR-011**: A status pill MUST reflect the time state (upcoming / live / ended) and, for a
  registrant with RSVP tracking on, their own RSVP.
- **FR-012**: The time banner MUST distinguish before-window (with the early-join minutes), in-window
  and ended, using the same window maths as `canJoinMeeting` / `hasMeetingEnded`.
- **FR-013**: The sticky identity bar's sign-in MUST preserve the current URL as `returnTo`,
  including `?password=` when present.
- **FR-014**: "Organized by" MUST NOT render for anonymous viewers (the BFF removes the fields), and a
  missing `MeetingUserInfo.name` MUST NOT render as the string `undefined`.

### Action slot

- **FR-020**: The action slot MUST render exactly one `ActionSlotKind`, chosen by
  `resolveActionSlot` per the state matrix, and MUST always carry `data-kind`; `none` is a rendered
  kind, not an absent element.
- **FR-021**: `register` MUST be offered only before the window, only on public-open meetings, to
  outsiders and visitors. For a visitor it MUST prompt sign-in first. A successful registration MUST
  move the slot to the registrant's state without a reload.
- **FR-022**: `invitation-required` MUST be shown to a signed-in outsider on a restricted meeting,
  before and during the window, with copy that says an invitation is needed. It replaces V1's empty
  rail and its post-click join error.
- **FR-023**: A registrant with RSVP tracking on MUST see their own current RSVP, not just the
  controls.
- **FR-024**: RSVP on a series MUST ask for a scope (all / this occurrence / this and following);
  on a single meeting it MUST submit `all` silently.
- **FR-025**: Every anonymous visitor inside the join window MUST get `guest-join`, whatever the
  privacy. On a restricted meeting the server's registrant-email match decides; a
  `NOT_REGISTERED_FOR_MEETING` response MUST explain the mismatch and let the viewer retry with a
  different email.
- **FR-026**: When RSVP tracking is off, a registrant MUST get `rsvp-unavailable`, and **no** RSVP
  UI may render anywhere on the page: no controls, summary strip, roster filter or per-avatar badge.
  Only the invitee count remains.
- **FR-027**: `join` MUST be offered in the window to organizers and registrants, and to signed-in
  outsiders on unrestricted meetings. The join control MUST have loading, ready and error states,
  and the existing auto-join behaviour (signed in, email present, `zoom_redirect` not disabled) MUST
  be kept.
- **FR-028**: After the meeting ends, the slot MUST be `tools` for organizers and for any viewer with
  `full_access`, and `no-access` otherwise. For an anonymous viewer with `full_access`, `tools` MUST
  render a sign-in variant until public artifact routes exist (E4-04).
- **FR-029**: Whether RSVP stays available beside Join during the window is an open decision (E2-01).
  Until decided, V2 MUST match V1: no RSVP in the window.

### Content sections

- **FR-030**: The agenda MUST render for every viewer except an ended meeting without `full_access`.
  Structured agenda items MUST wait for upstream U-07.
- **FR-031**: Materials MUST render for signed-in viewers, with the organizer's Manage control. An
  anonymous viewer MUST get a sign-in state whose copy is correct on public meetings too (V1 says
  "No primary materials available." when materials exist), until a public attachments route exists
  (E3-03).
- **FR-032**: The people roster MUST render only for registrants and organizers, and only with
  artifact access on an ended meeting. No viewer may be shown a registrant count the payloads no
  longer carry.
- **FR-033**: Past participants MUST show their identity tier (verified · needs review ·
  auto-matched · AI-reconciled) to the extent decided for the public surface in N-02, and MUST
  distinguish `zoom_user_name` from `mapped_invitee_name`.

### Past meetings, join details, occurrences, discovery

- **FR-040**: Meeting Tools MUST give recording, transcript and AI summary each an explicit
  unavailable state. Whether an unapproved summary shows ("Pending") or hides is an open decision
  (E4-03).
- **FR-041**: `no-access` MUST explain why, and MAY show feature badges (Recording, Transcripts, AI
  Summary) that have nothing behind them for this viewer.
- **FR-042**: The host key MUST render only for an organizer holding it, only inside
  start − 70 min to end + 40 min, and never on a past meeting.
- **FR-043**: Join details MUST NOT show a passcode or dial-in numbers until upstream U-04 / U-05
  provide them.
- **FR-044**: The occurrence strip MUST honour both cancellation sources (`cancelled_occurrences[]`
  in seconds, `status === 'cancel'`) and MUST show a cancelled occurrence as cancelled, not drop it
  silently.
- **FR-045**: "Discover more" MUST use the existing public project-meetings feed and groups
  directory, and MUST link to the public project calendar rather than rebuild it.

### Scope guards

- **FR-050**: V2 MUST NOT add: add-to-calendar, `.ics` download, share beyond copy-link, passcode
  display, dial-in numbers, recording download, an inline video player, approve/edit of the AI
  summary, or attendance export.
- **FR-051**: Edit, delete, cancel-occurrence and in-page organizer editing (O-01 to O-04) are new
  scope on this page, not a port, and MUST be organizer-only.
- **FR-052**: Magic-link arrival (M-01) MUST NOT ship before upstream U-08 and the M-02 security
  requirements.
- **FR-053**: A security change (e.g. E10-01, matching restricted meetings against all verified
  emails) MUST ship in its own PR, never inside feature work (R06).

### Quality

- **FR-060**: Every V2 element named in `testid-contract.md` MUST carry that testid, and state MUST
  live in `data-*` attributes, never in class names.
- **FR-061**: V2 MUST meet WCAG 2.2 AA: text contrast from the token layer, focus rings at 3:1,
  keyboard reachability, and no focus trap in the sticky bar.
- **FR-062**: V1's specs MUST stay green, and every V2 test MUST be proven binding by a source
  mutation (R07).
- **FR-063**: E2E MUST cover every preset in the plan (content and robust specs), and assert every
  illegal combination as its redirect.

## Success criteria

- **SC-001**: For every legal cell of the state matrix, the rendered `meeting-action-slot[data-kind]`
  equals the matrix's V2 kind — checked by the resolver's table test and by E2E on the presets.
- **SC-002**: Every illegal combination lands on `/meetings/not-found` in E2E; none renders a page.
- **SC-003**: An invitee with no LFX session opens their invite link to a restricted meeting during
  the window and joins through the guest form, without signing in.
- **SC-004**: No viewer sees an empty action slot without explanation: `none` appears only in the
  cells the matrix assigns it.
- **SC-005**: On a pre-2024 meeting, a DOM query finds zero RSVP controls, summary strips, roster
  filters and RSVP avatar badges, for every viewer.
- **SC-006**: With the flag off, 100% of page loads render V1 and download no V2 chunk; V1's
  component files are byte-identical to `main`.
- **SC-007**: No legal cell produces a hydration mismatch or a flash of stale meeting content on
  in-place navigation.
- **SC-008**: A reviewer can find, for every open Phase 1 and Phase 2 issue, the `FR-###` it
  satisfies.

## Traceability

Issue numbers are given where the issue exists; plan IDs without a number are not filed yet.

| Plan ID                       | Issue | Requirements                   |
| ----------------------------- | ----- | ------------------------------ |
| V2-01 flag gate               | #2873 | FR-001, FR-002, FR-003         |
| V2-02 scaffold                | #2874 | FR-001, FR-004                 |
| V2-03 rollout doc             | #2875 | FR-001, FR-003, SC-006         |
| E0-02 view model              | #2876 | FR-020, FR-026, FR-028, SC-001 |
| E0-04 testid contract         | #1768 | FR-020, FR-060                 |
| E0-05 design tokens           | #1769 | FR-061                         |
| E1-01 page shell              | #1770 | FR-005, FR-006                 |
| E1-02 sticky identity bar     | #1771 | FR-013, FR-061                 |
| E1-03 header                  | #1772 | FR-014                         |
| E1-04 privacy chip            | #1773 | FR-010                         |
| E1-05 status pill             | #2877 | FR-011                         |
| E1-06 time banner             | #1774 | FR-012                         |
| E2-01 action slot             | #1775 | FR-020, FR-027, FR-029, SC-004 |
| E2-02 outsider + register     | #2878 | FR-021                         |
| E2-03 invitation required     | #2879 | FR-007, FR-022                 |
| E2-04 own RSVP                | #2880 | FR-023                         |
| E2-05 RSVP card + scope       | #2881 | FR-024                         |
| E2-06 guest join in the rail  | #2882 | FR-025, SC-003                 |
| N-01 pre-2024 RSVP            | —     | FR-026, SC-005                 |
| N-02 identity tiers           | —     | FR-033                         |
| E3-01 agenda                  | —     | FR-030                         |
| E3-02 materials               | —     | FR-031                         |
| E3-03 public attachments      | —     | FR-031                         |
| E3-04 people                  | —     | FR-032                         |
| E3-05 attachment categories   | —     | FR-031                         |
| E4-01 recording + transcript  | —     | FR-028, FR-040                 |
| E4-03 inline AI summary       | —     | FR-040                         |
| E4-04 public artifact routes  | —     | FR-028                         |
| E4-05 align with admin page   | —     | FR-041                         |
| E5-02 accessibility           | —     | FR-061                         |
| E5-03 V2 specs                | —     | FR-062                         |
| E5-04 E2E                     | —     | FR-063, SC-001, SC-002, SC-003 |
| E6-03 / E6-04 / E6-05         | —     | FR-044                         |
| E7-01 / E7-02 join details    | —     | FR-042, FR-043                 |
| E8-04 / E8-05 discover more   | —     | FR-045                         |
| E9-01 / E9-02 agenda items    | —     | FR-030 (blocked on U-07)       |
| E10-01 verified-email match   | —     | FR-053                         |
| E10-02 / E10-03 identity UX   | —     | FR-013, FR-025                 |
| O-01 – O-04 organizer dialogs | —     | FR-051                         |
| M-01 / M-02 magic link        | —     | FR-052                         |

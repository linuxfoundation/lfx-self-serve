# Meeting details V2 — data model

Plan ID **E0-01** · issue [#1766](https://github.com/linuxfoundation/lfx-self-serve/issues/1766) · epic [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765)

Which payload fields feed which state axis, and what the derived view model holds. The runtime half
of this document is `packages/shared/src/interfaces/meeting-view-model.interface.ts` and
`packages/shared/src/utils/meeting-view-model.utils.ts` (E0-02, PR #2909, pending on `main`); this
file describes what they encode rather than restating their code. Field references are to `main`
@ `1ee353054`.

## Payloads

The page reads one of two public payloads, never both for the same render:

| Payload                                                                   | When                                                          | Carries                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /public/api/meetings/:id` → `{ meeting, project }`                   | upcoming or live, and the series id of a recurring meeting    | the full `Meeting`, per-viewer `invited` / `organizer`, `host_key` when the viewer holds it |
| `GET /public/api/meetings/past/:id` → `{ meeting, project, full_access }` | a composite `{meetingId}-{13-digit ms}` id, or a 404 fallback | the past meeting; trimmed to 19 fields when `full_access` is false                          |

Anonymous responses have `created_by`, `owner` and `organizers` removed. `host_key` is stripped
from every past payload. Neither upcoming detail endpoint populates registrant counts any more
(GH-1731) — see [Counts](#counts).

## Field → axis

| Axis                  | Derived from                                                                                                                                                                                                                  | Resolver                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| A. Time               | `start_time`, `duration`, `early_join_time_minutes` (default 10), end buffer `MEETING_END_BUFFER_MS` (40 min), for the occurrence the page is showing. A composite id puts the **page** in past mode before any resolver runs | `resolveTimeState`                |
| B. Viewer             | session (`authenticated`), `meeting.invited`, `meeting.organizer` — organizer wins over invited; anonymous is always `visitor`                                                                                                | `resolveViewerRole`               |
| C. Privacy            | `visibility` (nullable, **null reads as private**) × `restricted` (`true` only when strictly true)                                                                                                                            | `resolvePrivacy`                  |
| D. Past access        | `full_access` on the past payload; organizers always count as having it                                                                                                                                                       | shared rule inside the resolvers  |
| E. Cadence            | `meeting.recurrence !== null`                                                                                                                                                                                                 | section input `recurring`         |
| F. RSVP tracking      | `Meeting.is_invite_responses_enabled`, normalized by `normalizeIndexedMeetingInviteResponses` from the indexed alias `use_new_invite_email_address`. **Read the normalized field only.**                                      | `isMeetingInviteResponsesEnabled` |
| G. Arrival credential | `?password=` in the URL, or the password handed over in router state by the composer                                                                                                                                          | not in the view model — see below |

Axis G never reaches the view model. It decides whether the page loads at all (see the state
matrix's reachability section), so by the time a resolver runs, G has already done its work: a
loaded non-open page implies the viewer holds the password. That is why joining keys on
`restricted`, not on `openToPublic`.

## Derived view model

What `meeting-view-model.interface.ts` defines, and the rule behind each piece:

- **`MeetingTimeState`** — `before | live | ended`.
- **`MeetingViewerRole`** — `visitor | outsider | registrant | organizer`. There is no `host` role:
  nothing on the payload distinguishes a host from an organizer; the host key is a property of an
  organizer inside the host-key window.
- **`MeetingPrivacyState`** — the header chip's `label` and `icon` (from the shared helpers),
  `visibility`, `restricted`, and `openToPublic` (public **and** unrestricted). `openToPublic` gates
  self-registration only.
- **`ActionSlotKind`** — nine kinds; the state matrix gives the kind for every legal cell.
- **`MeetingSectionVisibility`** — one boolean per region: agenda, materials, join details,
  occurrences, people, tools, and the three RSVP surfaces (summary, roster filter, avatar badges).

Two invariants tie the resolvers together:

1. **The rail and the sections agree.** When the slot resolves to `tools`, the tools section is
   visible; both read one shared artifact-access rule (organizer or `full_access`).
2. **RSVP tracking removes, it does not vary.** When F is off, every RSVP surface is false and no
   RSVP slot kind is returned.

## Counts

| Count                                                     | Where it comes from now                                        | Who can have it                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Invitees / accepted / declined / pending (upcoming)       | the roster, via `/api/meetings/:uid/my-meeting-registrants`    | registrants and organizers only                                              |
| `individual_registrants_count`, `committee_members_count` | **not populated** on either upcoming detail endpoint (GH-1731) | nobody — still optional on the interface, so TypeScript will not flag a read |
| Attended / participant counts (past)                      | authenticated `/api/past-meetings/:uid` still fills them       | signed-in viewers with access                                                |

Anonymous and outsider viewers have no count source. V2 MUST NOT design one in (FR-032).

## RSVP

- `RsvpResponse`: `accepted | maybe | declined`. "Pending" is the absence of a response.
- `RsvpScope`: `single | all | this_and_following`; asked only on a series.
- `RegistrantAttendanceStatus` (`rsvp-calculator.util.ts`): `accepted | declined | maybe | pending`.
  Callers of `getRegistrantAttendanceStatus` / `countRegistrantAttendance` MUST pass
  `{ inviteResponsesEnabled }`, or calendar-invite acceptance is counted as an RSVP on pre-2024
  meetings.

## Identifiers

| Identifier                   | Format                                 | Trap                                                                |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| Composite past-occurrence id | `/^\d+-\d{13}$/` — numeric id + **ms** | forces past mode; the base id must be numeric                       |
| `cancelled_occurrences[]`    | Unix **seconds** (10 digits)           | compared directly against `occurrence_id`, not re-derived from time |
| Occurrence ids in URLs       | **ms** (13 digits)                     | do not mix with the seconds above                                   |

## Past participants

`PastMeetingParticipant` carries `is_verified`, `is_unknown`, `is_auto_matched`,
`is_ai_reconciled`, `zoom_user_name` and `mapped_invitee_name`, all optional. Nothing renders them
today; N-02 decides how much of each tier the public surface shows (FR-033).

## Not in the model yet

Each needs an upstream change first (implementation plan §8; not yet filed as issues):

| Blocker | Missing field                                    | Blocks         |
| ------- | ------------------------------------------------ | -------------- |
| U-01    | attendance counts on `v1_past_meeting`           | E6-06          |
| U-02    | per-occurrence RSVP-accepted counts              | E6-04 (soft)   |
| U-03    | recording-exists flag per past occurrence        | E6-03 (marker) |
| U-04    | Zoom meeting id + passcode on the detail payload | E7-01, E7-03   |
| U-05    | dial-in numbers                                  | E7-01          |
| U-06    | committee `logo_url`                             | E8-04 (soft)   |
| U-07    | structured `agenda_items`                        | E9-01 – E9-03  |
| U-08    | magic-link tokens                                | M-01           |

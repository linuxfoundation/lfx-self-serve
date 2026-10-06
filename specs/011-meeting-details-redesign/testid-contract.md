# Meeting details V2 — `data-testid` contract

Plan ID **E0-04** · issue [#1768](https://github.com/linuxfoundation/lfx-self-serve/issues/1768) · epic [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765)

This file is the authoritative list of `data-testid` values and state attributes for the V2
meeting details tree. It is written before the components exist so that E5-04 (the V2 E2E suite)
and every component PR between here and there agree on the same names, and so a test author never
has to read a template to find a selector.

V1 (`meeting-join.component.html`) is untouched by this work and keeps its own testids. V2 uses its
own namespace; the two never share a value.

## Rules

1. **Identity in `data-testid`, state in `data-*`.** A testid names _what the element is_ and never
   changes as the element's state changes. Anything that varies at runtime — a time phase, an
   action kind, an attendance answer — goes in a separate `data-*` attribute on the same element.
2. **State never lives in a class name.** Class names are styling, are minified and reordered by
   Tailwind's sorter, and are routinely changed for visual reasons. A test that asserts on one is
   asserting on the stylesheet. `[data-state="live"]` is stable in a way that `.is-live` is not.
3. **Dynamic testids carry stable identity, never an index.** `participant-row-${uid}` is correct;
   `participant-row-3` is not. Index-keyed ids break whenever the collection is filtered, sorted or
   paginated, which is exactly when a test is most likely to be catching a real bug. The interpolated
   value is the entity's own id (`uid`, `occurrenceId`, attachment `uid`) as it arrives from the API.
4. **`[section]-[component]-[element]`**, per `.claude/rules/development-rules.md` § Testing. Names
   are lowercase kebab-case throughout. V2 names read as a path down the page, so a failing selector
   tells you which section owns the bug.

## Page shell and header

| `data-testid`                           | Element                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `meeting-page-shell`                    | The V2 page container, present in every branch                                                                        |
| `meeting-skeleton`                      | Loading state (`role="status"`)                                                                                       |
| `meeting-content-column`                | The content column                                                                                                    |
| `meeting-rail`                          | The right-hand column (stacks below at ≤ 920px)                                                                       |
| `meeting-identity-bar`                  | The sticky identity bar (see below)                                                                                   |
| `meeting-identity-bar-home`             | Its LFX mark, linking home                                                                                            |
| `meeting-identity-bar-meeting`          | Its meeting identity: date tile, title, subtitle                                                                      |
| `meeting-identity-bar-title`            | The truncated meeting title                                                                                           |
| `meeting-identity-bar-subtitle`         | `{group} · {status}`                                                                                                  |
| `meeting-identity-bar-my-meetings`      | Signed in: My Meetings                                                                                                |
| `meeting-identity-bar-account`          | Signed in: the account menu button                                                                                    |
| `meeting-identity-bar-visitor-prompt`   | Visitor: the sign-in prompt                                                                                           |
| `meeting-identity-bar-create-account`   | Visitor: Create LFX account                                                                                           |
| `meeting-identity-bar-sign-in`          | Visitor: Sign in                                                                                                      |
| `meeting-header-section`                | The header region as a whole                                                                                          |
| `meeting-header-project`                | Project context: logo, name, foundation (a button opening the foundation, or plain when the parent is unresolved)     |
| `meeting-header-foundation`             | The foundation name under the project                                                                                 |
| `meeting-header-badges`                 | The badge row                                                                                                         |
| `meeting-header-badge-recurring`        | Recurring                                                                                                             |
| `meeting-header-badge-type`             | Meeting type                                                                                                          |
| `meeting-header-badge-committee-${uid}` | One committee chip, linking to `/groups/${uid}` in a new tab                                                          |
| `meeting-header-badge-recording`        | Recording enabled                                                                                                     |
| `meeting-header-badge-transcripts`      | Transcripts enabled                                                                                                   |
| `meeting-header-badge-youtube`          | YouTube upload enabled                                                                                                |
| `meeting-header-badge-ai-summary`       | AI summary enabled                                                                                                    |
| `meeting-header-copy-link`              | Copy meeting link                                                                                                     |
| `meeting-status-pill`                   | Status pill: time state, or the viewer's RSVP (see `data-status`)                                                     |
| `meeting-privacy-chip`                  | The single privacy chip (see below)                                                                                   |
| `meeting-time-banner`                   | The time banner at the top of the rail card (see below)                                                               |
| `meeting-time-banner-date`              | Its weekday and date, in the viewer's timezone                                                                        |
| `meeting-time-banner-time`              | Its start – end time                                                                                                  |
| `meeting-time-banner-timezone`          | Its timezone name                                                                                                     |
| `meeting-time-banner-skeleton`          | Its placeholder until the viewer's timezone resolves                                                                  |
| `meeting-time-banner-message`           | Its one phase line (starts … / starting soon / in progress / ended)                                                   |
| `meeting-time-banner-relative`          | Before the meeting, the ticking relative start (not announced)                                                        |
| `meeting-time-banner-phase`             | The phase sentence, a polite atomic live region that stays mounted                                                    |
| `meeting-action-slot`                   | The action slot inside the rail (see below)                                                                           |
| `meeting-action-join-button`            | The Join control in the `join` kind (see below)                                                                       |
| `meeting-action-join-error`             | Its error message (`role="alert"`)                                                                                    |
| `meeting-action-join-retry`             | Its error's "Try again" control                                                                                       |
| `meeting-action-join-different-email`   | After `NOT_REGISTERED_FOR_MEETING`, the control that opens the guest form to join with another email                  |
| `meeting-action-join-explainer`         | "Public meeting. Anyone with this link can join." under Join                                                          |
| `meeting-action-join-hint`              | Before the window, the early-join rule for a viewer who will be able to join                                          |
| `meeting-action-sign-in`                | The slot's sign-in control (`guest-join`, and `register` / `tools` for a visitor)                                     |
| `meeting-guest-join-form`               | The guest join form (`guest-join`, and the different-email path)                                                      |
| `meeting-guest-join-name`               | Its full-name field                                                                                                   |
| `meeting-guest-join-email`              | Its email field                                                                                                       |
| `meeting-guest-join-organization`       | Its organization field                                                                                                |
| `meeting-guest-join-button`             | Its Join control (see below)                                                                                          |
| `meeting-guest-join-error`              | Its error message (`role="alert"`)                                                                                    |
| `meeting-action-register-button`        | `register`'s "Register for meeting" control, for a signed-in outsider                                                 |
| `meeting-action-message`                | The slot's line of copy: a finished kind's explanation, or the one line for a kind whose full design is still to come |
| `meeting-organizer`                     | "Organized by" in the rail card                                                                                       |
| `meeting-organizer-name`                | The organizer's display name                                                                                          |
| `meeting-error-state`                   | Terminal error state                                                                                                  |
| `meeting-error-retry-button`            | The error state's "Try again" control                                                                                 |
| `meeting-invitation-required-state`     | The signed-in-outsider / invitation-required state                                                                    |
| `meeting-invitation-required-contact`   | Its "Contact the organizer" `mailto:` control                                                                         |
| `meeting-invitation-required-support`   | Its "Contact support" control, when the organizer has no usable email                                                 |
| `meeting-occurrence-edit-button`        | Organizer's "Edit this occurrence" control                                                                            |
| `meeting-occurrence-cancel-button`      | Organizer's "Cancel this occurrence" control                                                                          |

`meeting-section-placeholder-${section}` (`occurrences`, `agenda`, `materials`, `discover`) marks
the shell's stand-in for a section not built yet (E1-01). Each is temporary: the PR that builds the
section deletes its placeholder and its row here. A test must never assert on one.

The feature badges render from the `*_enabled` flags alone, whatever the viewer's artifact access
(FR-041). V1 names the same four `meeting-badge-*`; V2 keeps its own `meeting-header-badge-*`.

The two occurrence controls port V1's (#3040, #3206): organizer only, on a recurring meeting, for the
selected upcoming occurrence. V1 names them `meeting-reschedule-occurrence-button` and
`meeting-cancel-occurrence-button`; V2 uses its own names, as for everything else here.

`meeting-privacy-chip` is deliberately **one** testid, not four. E1-04 renders a single chip whose
copy and icon come from the existing `getMeetingPrivacyLabel` / `getMeetingPrivacyIcon` helpers, so
the four privacy permutations are four values of one element, not four elements.

### `meeting-identity-bar[data-condensed]`

```text
true | false
```

`true` once the page header has scrolled behind the bar, which is when the meeting identity fades
in and the visitor prompt fades out. A test asserts the swap on this attribute, not on opacity.

### `meeting-time-banner[data-state]`

Values mirror `MeetingTimeState` (`@lfx-one/shared/interfaces`, E0-02) exactly:

```text
before | live | ended
```

### `meeting-status-pill[data-state]` and `[data-my-rsvp]`

`data-state` carries the same `MeetingTimeState` values as the time banner, so E5-04 can assert the
pill's phase without reading its copy. `data-status` carries the full `MeetingStatusKind` from
`resolveMeetingStatus`, so a test asserts the RSVP variant without matching on its copy:

```text
data-state:   before | live | ended
data-status:  upcoming | starting-soon | live | ended | awaiting-rsvp | going | maybe | cant-attend
data-my-rsvp: accepted | maybe | declined | none
```

`data-my-rsvp` is the viewer's own answer for the selected occurrence (FR-011), `none` meaning not
answered yet. It is present **only** for a viewer who is on the invite list (`Meeting.invited`) on a
meeting with RSVP tracking on: a registrant, **or an organizer who is also invited**. The view model
resolves that organizer as the `organizer` role, and the action slot still returns `rsvp` for them,
as V1 lets an invited organizer set and see their own RSVP. Key the attribute on `invited`, not on
the role. Everywhere else it is absent, for the same reason `data-attendance` is (see People).

Until E2-04 (#2880) loads the viewer's own RSVP (the public payload does not carry it), the
attribute is absent for that viewer too, and `data-status` shows the time state. Absent therefore
never means `none`: a test asserts `data-my-rsvp` only once the RSVP has loaded.

### `meeting-privacy-chip[data-visibility]` and `[data-restricted]`

One chip, four values, carried as the two fields they come from. They mirror `MeetingPrivacyState`
from E0-02, so an absent `visibility` already reads as `private`:

```text
data-visibility: public | private
data-restricted: true | false
```

### `meeting-action-slot[data-kind]`

Values mirror `ActionSlotKind` (E0-02) exactly — **all nine members**:

```text
join | rsvp | register | invitation-required | guest-join | tools | no-access | rsvp-unavailable | none
```

> Issue #1768's body lists six of these (`join|rsvp|register|invitation-required|tools|none`). That
> list predates E0-02, which resolves the viewer-state model and adds three distinct kinds. The nine
> above are correct; the issue body is stale. What each addition names, as `resolveActionSlot`
> decides it:
>
> - `guest-join` — any anonymous visitor inside the join window, whatever the privacy. On a
>   restricted meeting the server matches the submitted email against the registrants; this is how
>   an invitee without an LFX session joins from their invite link.
> - `no-access` — an ended meeting whose artifacts the viewer cannot see (no `full_access`, not an
>   organizer). V1 renders an empty page here.
> - `rsvp-unavailable` — a registrant before a pre-2024 meeting, where invite responses were never
>   collected. V1 renders an empty rail here.
>
> The signed-in outsider on a restricted meeting is **not** one of the additions: it resolves to
> `invitation-required`, which was already in the original six. V1 fails that state
> silently too, but the fix there is rendering the existing kind, not a new one. Assert each state
> against the kind above, not against the silent-failure list in `spec.md` § Smaller traps.

The attribute is always present and always carries one of the nine values; `none` is a rendered
kind, not an absent attribute. A test asserting "no action is offered" asserts
`[data-kind="none"]`, which distinguishes _deliberately nothing_ from _the slot failed to render_.

### `meeting-action-join-button[data-state]`

One element in three states, rather than V1's three testids
(`join-meeting-button-immediate` / `-error` / `-loading`, which stay V1's and are never reused here):

```text
data-state: loading | ready | error
```

`loading` is also the server render, since the join URL is fetched in the browser only. The
criterion in issue #1775 to keep V1's testids predates this contract; the rule above that V2 never
shares a V1 value wins.

### `meeting-guest-join-button[data-state]`

```text
data-state: idle | loading | ready | error
```

`idle` until the form's fields are valid (nothing to fetch yet), and also the server render. V1's
`guest-form-*` and `join-meeting-button-form` stay V1's and are never reused here.

## Occurrences

| `data-testid`                     | Element                           |
| --------------------------------- | --------------------------------- |
| `occurrence-strip-section`        | The occurrence strip              |
| `occurrence-chip-${occurrenceId}` | One occurrence chip               |
| `occurrence-browse-dialog`        | The browse-all-occurrences dialog |

## Agenda and materials

| `data-testid`           | Element           |
| ----------------------- | ----------------- |
| `agenda-section`        | Agenda section    |
| `materials-section`     | Materials section |
| `materials-file-${uid}` | One attached file |
| `materials-link-${uid}` | One attached link |

Files and links are separate prefixes rather than one `materials-item-${uid}` because E3-05 groups
attachments by category, and a test for the grouping needs to assert on type without first reading
the row's contents.

## People

| `data-testid`            | Element             |
| ------------------------ | ------------------- |
| `people-section`         | The roster section  |
| `participant-row-${uid}` | One participant row |

Upcoming and past rows come from different data, so they carry different state attributes. An
upcoming row is a `MeetingRegistrant`; a past row is a `PastMeetingParticipant`, which has no RSVP
and no registrant `type`. Never put the upcoming attributes on a past row: calling
`getRegistrantAttendanceStatus` on a participant returns `pending` for everyone, and
`data-invitation` has nothing to read.

### Upcoming rows: `participant-row-${uid}[data-attendance]` and `[data-invitation]`

Attendance and invitation are two independent axes and get two attributes; a single fused value
would force every test to know the whole cross-product.

```text
data-attendance:  accepted | declined | maybe | pending
data-invitation:  direct | committee
```

`data-attendance` mirrors `RegistrantAttendanceStatus` (`packages/shared/src/utils/rsvp-calculator.util.ts`),
computed by `getRegistrantAttendanceStatus` with `{ inviteResponsesEnabled }` passed. `data-invitation`
mirrors `MeetingRegistrant.type`: whether the person was invited directly or came in with a
committee. It is on every upcoming row, whatever the RSVP gate says.

`data-attendance` is present **only when `Meeting.is_invite_responses_enabled` is true.** RSVP has a
hard gate: meetings created before the January 2024 invite-responses release have no RSVP data at
all, and when the gate is closed every piece of RSVP UI disappears — controls, summary strip, roster
filter and per-avatar badge alike. An absent attribute is therefore the correct assertion for a
pre-2024 meeting, and a test that expects `data-attendance="none"` there is asserting UI the product
must not render.

### Past rows: `participant-row-${uid}[data-attended]` and `[data-invited]`

```text
data-attended: true | false
data-invited:  true | false
```

They mirror `PastMeetingParticipant.is_attended` and `.is_invited`, so a test can tell an invited
no-show from an uninvited attendee. Both are on every past row. The identity tier (verified · needs
review · auto-matched · AI-reconciled) gets its own attribute when N-02 decides how much of it the
public page shows; until then it has no name here.

## Tools, join details and discovery

| `data-testid`             | Element                    |
| ------------------------- | -------------------------- |
| `tools-section`           | Post-meeting tools section |
| `tools-recording-link`    | Recording link             |
| `tools-summary-btn`       | AI summary control         |
| `tools-transcript-btn`    | Transcript control         |
| `join-details-section`    | Join details region        |
| `discover-section`        | Discovery section          |
| `discover-group-${uid}`   | One discovery group        |
| `discover-meeting-${uid}` | One discovered meeting     |

### `tools-summary-btn[data-approval]`

```text
approved | pending | not-required
```

V1 already renders this state as an `Approved` or `Pending` badge on the summary control
(`meeting-join.component.html:547-549`), driven by `isPastMeetingSummaryVisible` /
`isPastMeetingSummaryAwaitingApproval` in `packages/shared/src/utils/past-meeting-summary.utils.ts`.
V1 shows no badge in the third case, a summary with `requires_approval: false` that was never
approved because it never needed to be. V2 names that case `not-required` rather than dropping the
attribute, for the same reason `none` is a rendered action kind: an absent attribute would be
indistinguishable from a control that failed to render.
Per Rule 1 it belongs in a `data-*` attribute, so E5-04 can assert the awaiting-approval case
without matching on badge copy.

The tools testids cover only what the product actually has — a recording link, a transcript, an AI
summary and that summary's approval state. Download-recording, an inline player, the approve and
edit _actions_ on a summary, and attendance export do not exist anywhere in LFX One, so they get no
names here; adding one would imply an affordance the epic is not building.

## V1 testids

V1's template carries 55 distinct testids — 37 static `data-testid` values and 18 bound through
`[attr.data-testid]` (recounted against `main` on 2026-10-04, after #3040 and #3206). **None of them is consumed by a spec that visits
`/meetings/:id`** — verified by exact-match search for `getByTestId('<name>')` across
`apps/lfx-one/e2e/`. They are not a contract. They stay because V1 stays, and they retire with it.

Three names are worth calling out because a search makes them look like details-page consumers when
they are not:

| `data-testid`                | Where the spec actually exercises it                                      |
| ---------------------------- | ------------------------------------------------------------------------- |
| `meeting-registrants-drawer` | `meeting-card.component.html`, via `/meetings` (the list) — not this page |
| `toggle-rsvp-view-button`    | `meeting-card.component.html`, via `/meetings` (the list) — not this page |
| `meeting-title`              | `meeting-card.component.html`, via `/meetings` (the list) — not this page |

All three names exist in `meeting-join.component.html` **and** `meeting-card.component.html`.
`meeting-rsvp-pre-feature.spec.ts` and `meeting-card-title-datetime-link.spec.ts` navigate to
`/meetings` and scope their locators to a card, so they assert on the card's copies. `meeting-card` owns its own names and is out of
scope for this epic — V2 of the details page does not inherit them.

The practical consequence for rollout: no existing spec breaks whichever tree the flag serves,
because no existing spec asserts on the V1 details tree at all. E5-04 writes the first specs against
this contract.

## Adding to this contract

A component PR that needs a testid not listed here adds the row in the same PR, in the section that
owns it, following the four rules above. The contract is meant to grow; what it is not meant to do
is disagree with the templates. A name that appears in a template and not here is a defect in the PR
that introduced it.

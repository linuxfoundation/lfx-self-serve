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

| `data-testid`                       | Element                                            |
| ----------------------------------- | -------------------------------------------------- |
| `meeting-header-section`            | The header region as a whole                       |
| `meeting-status-pill`               | Status pill (upcoming / live / ended)              |
| `meeting-privacy-chip`              | The single privacy chip (see below)                |
| `meeting-time-banner`               | The date/time banner                               |
| `meeting-action-slot`               | The action rail container (see below)              |
| `meeting-error-state`               | Terminal error state                               |
| `meeting-invitation-required-state` | The signed-in-outsider / invitation-required state |

`meeting-privacy-chip` is deliberately **one** testid, not four. E1-04 renders a single chip whose
copy and icon come from the existing `getMeetingPrivacyLabel` / `getMeetingPrivacyIcon` helpers, so
the four privacy permutations are four values of one element, not four elements.

### `meeting-time-banner[data-state]`

Values will mirror `MeetingTimeState` exactly. That type does not exist on `main` yet —
E0-02 (#1766's sibling, PR #2909) adds it to `@lfx-one/shared/interfaces`. Until that merges the
list below is the contract:

```text
before | live | ended
```

### `meeting-action-slot[data-kind]`

Values will mirror `ActionSlotKind` exactly — **all nine members**. Like `MeetingTimeState`,
this type arrives with E0-02 (PR #2909) and is not on `main` at the time of writing:

```text
join | rsvp | register | invitation-required | guest-join | tools | no-access | rsvp-unavailable | none
```

> Issue #1768's body lists six of these (`join|rsvp|register|invitation-required|tools|none`). That
> list predates E0-02, which resolves the viewer-state model and adds three distinct kinds. The nine
> above are correct; the issue body is stale. What each addition names, as `resolveActionSlot`
> decides it:
>
> - `guest-join` — an anonymous visitor inside the join window of a public, unrestricted meeting.
> - `no-access` — an ended meeting whose artifacts the viewer cannot see (no `full_access`, not an
>   organizer). V1 renders an empty page here.
> - `rsvp-unavailable` — a registrant before a pre-2024 meeting, where invite responses were never
>   collected. V1 renders an empty rail here.
>
> The signed-in outsider on a restricted or private meeting is **not** one of the additions: it
> resolves to `invitation-required`, which was already in the original six. V1 fails that state
> silently too, but the fix there is rendering the existing kind, not a new one. Assert each state
> against the kind above, not against the silent-failure list in `spec.md`.

The attribute is always present and always carries one of the nine values; `none` is a rendered
kind, not an absent attribute. A test asserting "no action is offered" asserts
`[data-kind="none"]`, which distinguishes _deliberately nothing_ from _the slot failed to render_.

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

### `participant-row-${uid}[data-attendance]` and `[data-invitation]`

Attendance and invitation are two independent axes and get two attributes; a single fused value
would force every test to know the whole cross-product.

```text
data-attendance:  accepted | declined | maybe | pending
data-invitation:  direct | committee
```

`data-attendance` mirrors `RegistrantAttendanceStatus` (`packages/shared/src/utils/rsvp-calculator.util.ts`),
computed by `getRegistrantAttendanceStatus` with `{ inviteResponsesEnabled }` passed. `data-invitation`
mirrors `MeetingRegistrant.type`: whether the person was invited directly or came in with a
committee. It is on every row, whatever the RSVP gate says.

`data-attendance` is present **only when `Meeting.is_invite_responses_enabled` is true.** RSVP has a
hard gate: meetings created before the January 2024 invite-responses release have no RSVP data at
all, and when the gate is closed every piece of RSVP UI disappears — controls, summary strip, roster
filter and per-avatar badge alike. An absent attribute is therefore the correct assertion for a
pre-2024 meeting, and a test that expects `data-attendance="none"` there is asserting UI the product
must not render.

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

V1's template carries 56 distinct testids — 38 static `data-testid` values and 18 bound through
`[attr.data-testid]`. **None of them is consumed by a spec that visits
`/meetings/:id`** — verified by exact-match search for `getByTestId('<name>')` across
`apps/lfx-one/e2e/`. They are not a contract. They stay because V1 stays, and they retire with it.

Two names are worth calling out because a substring search makes them look like details-page
consumers when they are not:

| `data-testid`                | Where the spec actually exercises it                                      |
| ---------------------------- | ------------------------------------------------------------------------- |
| `meeting-registrants-drawer` | `meeting-card.component.html`, via `/meetings` (the list) — not this page |
| `toggle-rsvp-view-button`    | `meeting-card.component.html`, via `/meetings` (the list) — not this page |

Both names exist in `meeting-join.component.html` **and** `meeting-card.component.html`.
`meeting-rsvp-pre-feature.spec.ts` navigates to `/meetings` (line 122) and scopes both locators to
`organizerCard`, so it asserts on the card's copies. `meeting-card` owns its own names and is out of
scope for this epic — V2 of the details page does not inherit them.

The practical consequence for rollout: no existing spec breaks whichever tree the flag serves,
because no existing spec asserts on the V1 details tree at all. E5-04 writes the first specs against
this contract.

## Adding to this contract

A component PR that needs a testid not listed here adds the row in the same PR, in the section that
owns it, following the four rules above. The contract is meant to grow; what it is not meant to do
is disagree with the templates. A name that appears in a template and not here is a defect in the PR
that introduced it.

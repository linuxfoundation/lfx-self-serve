# Feature Specification: Meeting details redesign (V2)

**Feature Branch**: `011-meeting-details-redesign`
**Epic**: [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765)
**Plan ID**: E0-01 · **Issue**: [#1766](https://github.com/linuxfoundation/lfx-self-serve/issues/1766)
**Design**: `Meeting Details.dc.html` (Cowork design share; HTML is the visual spec, not Figma)

> **Scope of this document.** This is the handoff-sized spec: the governing rules, the work order,
> and the non-obvious facts that will cause rework if a developer does not know them. It is
> deliberately not the full deliverable #1766 asks for — see [Outstanding](#outstanding-from-1766)
> for what remains and why it was deferred.

## Why this exists

Three prototype-driven meetings redesigns have already been abandoned in this repo (composer
PRs #1751–#1764, all closed unmerged). This epic therefore over-invests in the flag gate and the
contracts before any V2 component exists, and it writes its intent down in the repo rather than
leaving it in a chat transcript.

## The two rules that govern every issue in this epic

### 1. V2 only. V1 is untouched

Several issues in this epic were originally written as refactors of the live component. They have
all been reframed. You are building **new** components that the feature flag renders.
V1's component files keep **byte-identical contents**: no edit to their code, template, class name
or selector. The one permitted change is a mechanical directory move: V2-02 moves them to
`meeting-join-v1/` to follow the composer's `-v1` naming, and git records that as a pure rename.
V1's behaviour is unchanged either way. If an issue body still reads like a refactor, follow the V2
framing note in it.

### 2. Reuse before you create

Follow the prototype for design, but build it from what already exists:

```text
button          card            tag               avatar          person-avatar
select          select-button   select-chip       selectable-card card-selector
table           message         empty-state       expandable-text filter-pills
toast-message   input-text      textarea          time-picker     file-upload
markdown-renderer  metric-card  stat-card-grid    settings-card   token-reveal-dialog
```

Do not rebuild buttons, cards, tags, avatars, selects, inputs or tables. If a wrapper is close but
cannot express the design, prefer **adding an input or a variant to the wrapper** over forking it.
When you genuinely must create a component, say in the PR what you tried first. Divergence from the
app's look belongs in tokens and layout, not in a parallel component library.

## Rollout invariants

| ID  | Invariant                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| R01 | The existing meeting details page is not deleted, rewritten, or refactored in place.                                      |
| R02 | `MEETING_V2_ENABLED_FLAG` is UI-only. It gates no endpoint.                                                               |
| R03 | Fail closed — an unready flag provider renders V1.                                                                        |
| R04 | LaunchDarkly targeting is the switch. The code default is never the switch.                                               |
| R05 | Anonymous visitors get V1 until the anonymous stage of `rollout.md` (stage 5).                                            |
| R06 | Security changes never ride along with feature work.                                                                      |
| R07 | Every test must be proven binding: mutate the source, confirm the test fails, confirm the mutation landed via `git diff`. |

## Things that will bite you if you don't know them

### RSVP has a hard gate

`Meeting.is_invite_responses_enabled` is `true` **only** for meetings created after the January 2024
invite-responses release. When it is not true, all RSVP UI must disappear — no controls, no summary
strip, no roster filter, no per-avatar badge. Invitee count only.

- Read the **normalized** field. Never read the raw indexed alias `use_new_invite_email_address`.
- Any call into `getRegistrantAttendanceStatus` / `countRegistrantAttendance` must pass
  `{ inviteResponsesEnabled }` or it will over-report acceptances.

This is a first-class axis of the state model (**Axis F**), not a footnote.

### Registrant counts are gone from the detail payloads

`individual_registrants_count` and `committee_members_count` are no longer populated on either
detail endpoint, but they are **still optional on the interface** — TypeScript will not catch a
component that reads them.

For upcoming meetings, counts now come from the roster, and the roster is empty for anyone who is
neither a registrant nor an organizer. So anonymous and non-registrant viewers have **no count
source at all**. Do not design one in.

Past meetings count differently. Invitee, participant and attended counts come from the
past-meeting participants list (V1's `pastMeetingParticipants`), and the authenticated past-meeting
endpoint still fills its count fields, so a **signed-in** viewer with past-meeting access does have
counts. Anonymous viewers do not, even on a public, unrestricted past meeting where `full_access` is
true: V1 fetches participants only when the viewer is authenticated, so an anonymous viewer gets an
empty list, which must not be rendered as zero counts. Do not apply either rule to the other case.

### SSR contract

Preserve the `MeetingJoinPageState` TransferState seeding, **including the terminal-error branch**,
and the `meetingMatchesRoute()` stale-content guard. The skeleton and error states already exist in
V1 — in V2 they are a restyle, not a new build.

### Smaller traps

- `MeetingUserInfo.name` is optional. Organizer rendering must handle `undefined` without printing
  the string `undefined`.
- Three states are silent failures in V1 and are much of the point of this work:
  1. a signed-in outsider on a restricted meeting (empty action rail),
  2. an invited user on a pre-2024 meeting who cannot register (also empty),
  3. a cancelled occurrence (filtered out, with no copy anywhere).

### Do not invent affordances

None of these exist on the meeting details page, and none may be added to it by this epic. (Some
exist elsewhere. Committee and project `calendar.ics` feeds are offered from the committee page and
the Meetings dashboard. That does not make them in scope here.)

```text
add-to-calendar    .ics download     share beyond copy-link
download recording inline video player approve / edit AI summary
export attendance
```

Passcode display and dial-in numbers are **not** permanent exclusions. They are planned join-details
work (E7-01, E7-03) that is blocked upstream: U-04 (#2930) exposes the Zoom meeting ID and passcode,
U-05 (#2931) adds dial-in numbers. Until those land, V2 must not render either (FR-043).

Single-occurrence actions **are** on the V1 details page, so V2 must port them. Since PRs #3040
and #3206, an organizer of a recurring meeting gets "Edit this occurrence" (reschedule, title, agenda)
and "Cancel this occurrence" for the selected upcoming occurrence. Editing or deleting the **whole
series** still lives on the dashboard card and the edit wizard; putting those on the details page is
new scope, not a port.

## Work order

Phase 0 is the foundation.

### Phase 0 — foundation

| Plan ID | Issue | Item                                   |
| ------- | ----- | -------------------------------------- |
| V2-01   | #2873 | Feature-flag gate (shim component)     |
| V2-02   | #2874 | V2 scaffold + V1 rename                |
| V2-03   | #2875 | Rollout / retirement doc               |
| —       | #2920 | SSR flag decision (V2-01 follow-up)    |
| E0-01   | #1766 | This spec                              |
| E0-02   | #2876 | View-model + `ActionSlotKind` resolver |
| E0-03   | #1767 | ADR: public / admin surface boundary   |
| E0-04   | #1768 | Testid contract                        |
| E0-05   | #1769 | Design tokens                          |

Open/closed state lives on GitHub, not here. The one fact that does belong in this document is the
dependency: **Phase 1 cannot start until V2-02 (#2874) lands**, because it is the scaffold every
Phase 1 component hangs off.

The second ordering constraint is on rollout, not on building. Until #2920 gives SSR the flag
decision, a targeted viewer's first paint is V1 and V2 replaces it after hydration. So **the flag
stays on a named tester list until #2920 lands**: no percentage rollout and no V1 retirement before
it. Phase 1 work does not wait for it.

### Phase 1 — shell, header, action slot, content

| Group                       | Plan IDs (issues)                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell & header              | E1-01 (#1770) · E1-02 (#1771) · E1-03 (#1772) · E1-04 (#1773) · E1-05 (#2877) · E1-06 (#1774)                                                                                                                                                                                                                                                                      |
| Action slot & viewer states | E2-01 (#1775) · E2-02 (#2878) · E2-03 (#2879) · E2-04 (#2880) · E2-05 (#2881) · E2-06 (#2882) · N-01 (#3263) pre-2024 RSVP state                                                                                                                                                                                                                                   |
| Content                     | E3-01 (#3250) agenda · E3-02 (#3251) materials · E3-03 (#3252) public attachments endpoint (BFF) · E3-04 (#3253) people · E3-05 (#3254) attachment categories · E4-01 (#3255) recording + transcript · E4-02 (#3256) recording duration (BFF) · E4-03 (#3257) inline AI summary · E4-04 (#3258) public artifact routes (BFF) · E4-05 (#3259) align with admin page |
| Identity & admin            | N-02 (#3264) participant identity tiers · N-03 (#3265) auth guard on the past-meeting admin route                                                                                                                                                                                                                                                                  |
| Quality                     | E5-02 (#3260) a11y · E5-03 (#3261) V2 specs · E5-04 (#3262) E2E (content + robust). E5-01 shipped before the epic (#2046) and is not filed                                                                                                                                                                                                                         |

E1-04 renders a **single** 4-way privacy chip built on the existing `getMeetingPrivacyLabel` /
`getMeetingPrivacyIcon` helpers — four values of one element, not four elements.

E2-01 is the resolver-driven action slot with **nine** kinds. Issue bodies that list six predate
E0-02; see `testid-contract.md`.

N-01 is the pre-2024 RSVP-unavailable state. N-02 is participant identity tiers for past meetings —
verified · unknown/needs-review · auto-matched · AI-reconciled — plus the `zoom_user_name` vs
`mapped_invitee_name` distinction.

### Phase 2

| Sub-epic              | Plan IDs                                      | Upstream blocker                                                                 |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| E6 Occurrence UI      | E6-01 · E6-02 · E6-03 · E6-04 · E6-05 · E6-06 | U-01 (#2927) → E6-06 · U-02 (#2928) → E6-04 (soft) · U-03 (#2929) → E6-03 marker |
| E7 Join details       | E7-01 · E7-02 · E7-03                         | U-04 (#2930) → E7-01, E7-03 · U-05 (#2931) → E7-01                               |
| E8 Discover more      | E8-01 · E8-02 · E8-03 · E8-04 · E8-05         | U-06 (#2932) → E8-04 (soft; the glyph fallback works)                            |
| E9 Structured agenda  | E9-01 · E9-02 · E9-03                         | U-07 (#2933) → all three                                                         |
| E10 Identity matching | E10-01 · E10-02 · E10-03                      | none. The plan recommends pulling E10-01 into Phase 1                            |
| O Organizer dialogs   | O-01 · O-02 · O-03 · O-04                     | none                                                                             |
| M Magic link          | M-01 · M-02                                   | U-08 (#2934) → M-01; M-02 defines its security requirements                      |

### Phase 3

Spikes S-01 (colleague meetings feasibility and privacy) and S-02 (occurrence timeline scale), and
the hygiene bugs the plan lists in § 10. They are independent and can be filed at any time.

Every Phase 1 item is filed. Plan IDs listed without an issue number (Phase 2 and Phase 3) are
**not filed yet**. The issue
bodies are drafted in the implementation plan; file each before starting it.

The `U-` series is upstream API blockers: changes owned by `lfx-v2-meeting-service` and
`lfx-v2-committee-service`, tracked here as U-01 to U-08 (#2927 to #2934). The Phase 2 table shows
which item each one blocks.

## Outstanding from #1766

Deferred from this handoff spec and delivered alongside it in this directory:

- **`requirements.md`**: `FR-###` functional requirements and `SC-###` success criteria, with a
  traceability table so every Phase 1 and Phase 2 plan ID cites at least one FR.
- **`state-matrix.md`**: the seven state axes A–G (time, viewer, privacy, past access, cadence, RSVP
  tracking, arrival credential) plus page status, every legal combination with its expected page
  composition, and every illegal combination with its outcome (e.g. redirect to
  `/meetings/not-found`).
- **`data-model.md`**: field → axis mapping and what the E0-02 view model
  (`meeting-view-model.interface.ts`, E0-02) encodes. That includes the view-scoped state the
  axes do not cover: the selected occurrence and the viewer's own RSVP.

**`contracts/`** (JSON Schema for new or widened BFF responses) moves to the PRs that build each
endpoint (E3-03, E4-04, E6-01), so each schema is reviewed with its code.

### Deviations from #1766's acceptance criteria

- **"JIRA epic key recorded in `spec.md`"** — not done, deliberately. `.claude/rules/development-rules.md`
  § GitHub Issues mandates GitHub Issues and forbids Jira for this repo. Recorded as epic #1765 and
  parent #1451 instead.
- **"License header on all spec files"** — not done. No `.md` under `specs/` carries one
  (`008-signed-under-identity`, `009-cla-manager-request`), and `check-headers.sh` does not scan
  `*.md`. Following the existing precedent rather than creating a one-file exception.
- Two source documents #1766 references — `lfx-meeting-details-state-assessment.md` and
  `meeting-details-redesign-implementation-plan.md` (revised 2026-09-23) — **are not in this repo**.
  They are Cowork artifacts. The matrix work above needs them, or needs to be re-derived.

## Related documents

- [`state-matrix.md`](state-matrix.md), [`requirements.md`](requirements.md),
  [`data-model.md`](data-model.md) — the full state model, FR / SC, and field mapping (E0-01).
- [`testid-contract.md`](testid-contract.md) — every `data-testid` and `data-*` state attribute
  the V2 tree renders (E0-04).
- [`design-token-deviations.md`](design-token-deviations.md) — where V2 tokens diverge from the
  app's, and why (E0-05).
- [`v2-scaffold.md`](v2-scaffold.md) — V1/V2 naming, where V2 code lives, V1-deletion definition
  of done (V2-02).
- [`rollout.md`](rollout.md) — branch, release, flag stages and retirement (V2-03).
- `docs/architecture/frontend/docs-portal.md` — the repo's precedent for a spec-shaped doc.

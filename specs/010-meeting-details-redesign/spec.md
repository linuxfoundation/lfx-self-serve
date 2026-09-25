# Feature Specification: Meeting details redesign (V2)

**Feature Branch**: `010-meeting-details-redesign`
**Epic**: [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765)
**Plan ID**: E0-01 · **Issue**: [#1766](https://github.com/linuxfoundation/lfx-self-serve/issues/1766)
**Design**: `Meeting Details.dc.html` (Cowork design share; HTML is the visual spec, not Figma)

> **Scope of this document.** This is the handoff-sized spec: the governing rules, the work order,
> and the non-obvious facts that will cause rework if a developer does not know them. It is
> deliberately not the full deliverable #1766 asks for — see [Outstanding](#outstanding-from-1766)
> for what remains and why it was deferred.

## Why this exists

Three prototype-driven meetings redesigns have already been abandoned in this repo (composer PRs
#1751–#1764, all closed unmerged). This epic therefore over-invests in the flag gate and the
contracts before any V2 component exists, and it writes its intent down in the repo rather than
leaving it in a chat transcript.

## The two rules that govern every issue in this epic

### 1. V2 only. V1 is untouched

Several issues in this epic were originally written as refactors of the live component. They have
all been reframed. You are building **new** components that the feature flag renders.
`meeting-join.component.ts` stays byte-identical. If an issue body still reads like a refactor,
follow the V2 framing note in it.

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
| R05 | Anonymous visitors always get V1 during rollout.                                                                          |
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

Counts now come from the roster, and the roster is empty for anyone who is neither a registrant nor
an organizer. So anonymous and non-registrant viewers have **no count source at all**. Do not design
one in.

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

None of these exist anywhere in the product, and none may be added by this epic:

```text
add-to-calendar    .ics download     share beyond copy-link
passcode display   dial-in numbers   download recording
inline video player                  approve / edit AI summary
export attendance
```

Edit, delete and cancel-occurrence **do** exist — but on the dashboard card and the edit wizard.
Putting them on the details page is new scope, not a port.

## Work order

Phase 0 is the foundation.

### Phase 0 — foundation

| Plan ID | Issue | Item                                   |
| ------- | ----- | -------------------------------------- |
| V2-01   | #2873 | Feature-flag gate (shim component)     |
| V2-02   | #2874 | V2 scaffold + V1 rename                |
| V2-03   | #2875 | Rollout / retirement doc               |
| E0-01   | #1766 | This spec                              |
| E0-02   | #2876 | View-model + `ActionSlotKind` resolver |
| E0-04   | #1768 | Testid contract                        |
| E0-05   | #1769 | Design tokens                          |

Open/closed state lives on GitHub, not here. The one fact that does belong in this document is the
dependency: **Phase 1 cannot start until V2-02 (#2874) lands**, because it is the scaffold every
Phase 1 component hangs off.

### Phase 1 — shell, header, action slot, content

| Group                       | Plan IDs (issues)                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell & header              | E1-01 (#1770) · E1-02 (#1771) · E1-03 (#1772) · E1-04 (#1773) · E1-05 (#2877) · E1-06 (#1774)                                                                                                        |
| Action slot & viewer states | E2-01 (#1775) · E2-02 (#2878) · E2-03 (#2879) · E2-04 (#2880) · E2-05 (#2881) · E2-06 (#2882) · N-01                                                                                                 |
| Content                     | E3-01 agenda · E3-02 materials · E3-04 people · E3-05 attachment categories · E4-01 recording + transcript · E4-03 inline AI summary · E4-05 align with admin page · N-02 participant identity tiers |
| Quality                     | E5-02 a11y · E5-03 V2 specs · E5-04 E2E (content + robust)                                                                                                                                           |

E1-04 renders a **single** 4-way privacy chip built on the existing `getMeetingPrivacyLabel` /
`getMeetingPrivacyIcon` helpers — four values of one element, not four elements.

E2-01 is the resolver-driven action slot with **nine** kinds. Issue bodies that list six predate
E0-02; see `testid-contract.md`.

N-01 is the pre-2024 RSVP-unavailable state. N-02 is participant identity tiers for past meetings —
verified · unknown/needs-review · auto-matched · AI-reconciled — plus the `zoom_user_name` vs
`mapped_invitee_name` distinction.

### Phase 2

E6-03 · E6-04 · E6-05 · E7-01 · E7-02 · E8-04 · E8-05 · E9-01 · E9-02 · E10-02 · E10-03 ·
O-01…O-04 · M-01.

E9-01 / E9-02 are blocked on U-07; M-01 is blocked on its sibling U-08. **The `U-` series is not
defined anywhere in this epic and has no issue numbers here** — it came across from the original
brief unresolved. Resolve what U-07 / U-08 track before planning any of those three items.

## Outstanding from #1766

Deferred deliberately; #1766 stays open until these land.

- **`FR-###` functional requirements** — one per legal state combination and per section, so every
  Phase-1/Phase-2 issue can cite at least one.
- **`SC-###` success criteria.**
- **`data-model.md`** — the five axes plus Axis F, the derived view-model, and the field → state
  mapping. E0-02 (#2876) will ship the runtime half of this as `meeting-view-model.interface.ts`
  (PR #2909, unmerged at the time of writing); the document should describe what that file encodes
  rather than restate it.
- **`contracts/`** — JSON Schema for any new or widened BFF response (`MeetingOccurrenceSummary`,
  public attachments, public artifacts).
- **The full state matrix** — every legal combination with its expected page composition, and every
  explicitly illegal combination with its outcome (e.g. redirect to `/meetings/not-found`).

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

- `testid-contract.md` — every `data-testid` and `data-*` state attribute the V2 tree renders.
  _Pending: E0-04 (#1768), PR #2913 — not on `main` yet._
- `design-token-deviations.md` — where V2 tokens diverge from the app's, and why.
  _Pending: E0-05 (#1769), PR #2911 — not on `main` yet._
- `docs/architecture/frontend/docs-portal.md` — the repo's precedent for a spec-shaped doc.

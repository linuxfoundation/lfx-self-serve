# Meeting surfaces: public page vs admin page

**Decision record E0-03** · issue [#1767](https://github.com/linuxfoundation/lfx-self-serve/issues/1767) ·
epic [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765) · **Status:** accepted for
the meeting details V2 epic · follows GH [#2251](https://github.com/linuxfoundation/lfx-self-serve/issues/2251)
and PR [#2252](https://github.com/linuxfoundation/lfx-self-serve/pull/2252)

Two pages render a meeting. This record decides what each one is for, how a viewer is sent to one or
the other, and which capability lives where, so that later issues stop guessing.

| Surface    | Route                                                               | Component                                                                                     | Audience                                                          |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Public** | `/meetings/:id`                                                     | `MeetingDetailsGateComponent` → V1 `MeetingJoinComponent` or V2 `MeetingDetailsPageComponent` | Everyone, anonymous included. SSR. Access tiered by `full_access` |
| **Admin**  | `/meetings/:id/details` (also under `/project/` and `/foundation/`) | `PastMeetingDetailsComponent`                                                                 | Manage-role viewers of a **past** meeting                         |

## History: why this reverses the earlier plan

The 2026-08-22 plan proposed retiring `/meetings/:id/details` and folding it into the public page.
That was overtaken before any of it was built:

- PR [#2215](https://github.com/linuxfoundation/lfx-self-serve/pull/2215) put the organizer-only
  attendance reconciliation drawer on `/details`, and only there.
- GH #2251, from the foundation/project permissions review, and its PR #2252 made `/details` the page
  Manage-role users are sent to from the past-meeting card.

This record follows #2251: `/details` stays, as the admin surface. Issue #1767 was rewritten on
2026-09-09 to match, and E4-05 ([#3259](https://github.com/linuxfoundation/lfx-self-serve/issues/3259))
dropped its redirect-and-delete scope at the same time. Nothing earlier is superseded silently.

## Decision 1 — what each surface is for

- **The public page is the read and participate experience** for one meeting, upcoming or past:
  what it is, when it is, how to join or register, how to answer the invite, and what it produced.
  Organizer actions that belong to an _upcoming_ meeting also live here, because there is no admin
  page for an upcoming meeting.
- **The admin page is where a Manage-role viewer corrects the record of a past meeting**: who
  attended, who they really were, and what is attached. It is not a second read view.

### Capability split

Every section of either page today, with where it belongs. "V1" is `meeting-join-v1/meeting-join.component.html`, "admin" is
`past-meeting-details/past-meeting-details.component.html`.

| Capability                                                                          | Today on        | Decision            | Reason / owner                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Title, badges (ended, privacy, type, recurring), date, organizer                    | both            | **both**            | Identity of the meeting. Each page needs it to make sense on its own.                                                                                                                                                                                                                                                                |
| Feature badges (recording, transcripts, AI summary)                                 | both            | **both**            | Cheap orientation. On the public page FR-041 limits them for `no-access`.                                                                                                                                                                                                                                                            |
| Recording, transcript, AI summary (read)                                            | both            | **both**            | The admin needs them to check the record; the public page is where attendees go for them (E4-01, E4-03). Read-only on both.                                                                                                                                                                                                          |
| Agenda                                                                              | both            | **both**            | Context for the record on admin; FR-030 on public.                                                                                                                                                                                                                                                                                   |
| Materials (read, download)                                                          | both            | **both**            | Same as agenda. FR-031 on public.                                                                                                                                                                                                                                                                                                    |
| Materials manage (upload, link, delete)                                             | both            | **both**            | Organizer-gated on both. Public: wherever content is visible, ended meetings included (FR-031, as V1 does today), and the only place to do it before a meeting. Admin: past meetings. Attachments are not the attendance record, so they are not admin-only.                                                                         |
| Attendance aggregate (rate, attended, absent)                                       | both            | **both**            | Public folds in the admin version's rate bar and thresholds (E4-05). One source of truth for the figures (E4-05 acceptance).                                                                                                                                                                                                         |
| Past participant roster (names, attended, invited, filters)                         | both            | **both, minimised** | Public: signed-in viewers with artifact access only (FR-032), folded in from admin by E4-05, with the fields in § Public roster fields. Admin: the full table it already has.                                                                                                                                                        |
| Per-participant committee voting status                                             | admin           | **admin**           | Committee standing of named people. On a public-open ended meeting the public roster reaches every signed-in LFX user, which is too wide for it. Narrows E4-05's "fold in voting status" scope.                                                                                                                                      |
| Participant identity tiers (verified · needs review · auto-matched · AI-reconciled) | neither         | **both, tiered**    | N-02 ([#3264](https://github.com/linuxfoundation/lfx-self-serve/issues/3264)). Public: verified identities plus an "N unidentified attendees" aggregate. Admin: the full tiering. Departs from #1767's starting position (admin-only) because a public roster that presents every row as equally verified misstates the data (N-02). |
| Attendance reconciliation (drawer, `POST …/reconcile`, `PUT …/participants/:id`)    | admin           | **admin**           | Writes to the attendance record.                                                                                                                                                                                                                                                                                                     |
| Participant create / delete (`POST`, `DELETE …/participants`)                       | API only, no UI | **admin**           | Writes to the attendance record. If a UI is ever built, it goes here.                                                                                                                                                                                                                                                                |
| Any future roster administration or attendance correction                           | —               | **admin**           | Same rule.                                                                                                                                                                                                                                                                                                                           |
| "Invite" per participant (disabled, "Coming soon")                                  | admin           | **neither**         | Not an affordance the product has. E4-05 does not carry it over.                                                                                                                                                                                                                                                                     |
| Join, guest join, register, RSVP (own answer and organizer aggregate)               | public          | **public**          | Participation. Meaningless on a past meeting.                                                                                                                                                                                                                                                                                        |
| Host key                                                                            | public          | **public**          | Live-window credential (FR-042). Never on a past meeting.                                                                                                                                                                                                                                                                            |
| Occurrence navigation and browse                                                    | public          | **public**          | Admin is scoped to one past occurrence.                                                                                                                                                                                                                                                                                              |
| Occurrence edit and cancel (#3040, #3206)                                           | public          | **public**          | Upcoming-occurrence organizer actions (FR-046). No admin page exists for an upcoming meeting.                                                                                                                                                                                                                                        |
| Add registrant                                                                      | public          | **public**          | Upcoming-only (V1 `showAddRegistrant`).                                                                                                                                                                                                                                                                                              |
| Foundation / project / committee context, copy link, discovery                      | public          | **public**          | Orientation for a visitor; the admin page sits inside the app shell, which already carries project context.                                                                                                                                                                                                                          |
| Summary edit and approve                                                            | meetings list   | **neither page**    | Lives on the meeting card's summary modal today. Out of scope here; both pages stay read-only for summaries.                                                                                                                                                                                                                         |

### Public roster fields

On an ended public-open meeting, `full_access` is true for every signed-in viewer (`state-matrix.md`
Axis D), so the public roster reaches any signed-in LFX user. It therefore carries less than the
admin table:

| Field                   | Public roster         | Admin table |
| ----------------------- | --------------------- | ----------- |
| Name and avatar         | yes                   | yes         |
| Organization            | yes                   | yes         |
| Attended / invited      | yes                   | yes         |
| Identity tier           | aggregate only (N-02) | full        |
| Email                   | **no**                | yes         |
| Job title               | **no**                | yes         |
| Committee voting status | **no**                | yes         |

V1's past participant list shows email today (`meeting-registrants-display`). V2 does not carry that
over; V1 is unchanged until it retires. E4-05 and N-02 implement this table, not the admin row as
it stands.

### Duplication policy

A capability is on **both** surfaces only when it is in the table above with a reason. Everything
else exists on exactly one. In particular:

- **No write to the attendance record appears on the public page**, for any viewer. Materials
  management is not such a write.
- **No participation action appears on the admin page.**
- Read sections that appear on both render from the same shared helpers and the same source of
  truth (E4-05), so the two pages cannot disagree about one meeting's numbers.

A new capability is placed by the same test: does it change the record of a past meeting? Admin.
Does it help someone take part in, or consume, a meeting? Public. Anything else needs this record
amended first.

## Decision 2 — routing: how a viewer gets to each

**The role is `meeting.organizer`, as the BFF resolves it** from the FGA relation
`v1_past_meeting#organizer`, which fails closed for anonymous viewers and on error. Two code paths
compute it:

- **List** (the card): `MeetingService.getMeetings` → `addAccessToResources(…, 'organizer')`, keyed
  on the record `id`.
- **Detail**: `isPastMeetingOrganizer` in `past-meeting.controller.ts`, keyed on
  `meeting_and_occurrence_id ?? uid`, behind `GET /api/past-meetings/:uid`.

The relation is the same; the object id is not. The N-03 guard MUST use the detail path, so the
decision is made for the exact occurrence being opened; the card is only a hint. Per #2252 and #2234 it already covers organizers,
project writers and project EDs — the Manage role. There is no second role model: this page does not
read persona, lens or writer-guard state to decide.

**Where the decision lives:**

1. **The card CTA** (exists, #2252). `MeetingCardComponent.initMeetingDetailUrl` links a past
   meeting to `/details` when `meeting.organizer` is true, and to `/meetings/:id` otherwise.
2. **A guard on `/details`** (N-03, [#3265](https://github.com/linuxfoundation/lfx-self-serve/issues/3265)).
   Today the route has no `canActivate` of its own; the parent guards (`authGuard`, plus
   `projectQueryParamGuard` and, on the flat mount, `lensRedirectGuard`) prove a session and set
   project context, but none checks access to this meeting. N-03 adds a `canActivate` that resolves `organizer` for the requested meeting through the
   BFF and decides as below.
3. **Not a redirect from the public page.** A Manage-role viewer may open `/meetings/:id` directly
   and gets the public page. That is a legal state (`state-matrix.md` § Not an access dimension).

### Who sees what on `/details`

| Viewer                                   | Outcome                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous                                | Unchanged: Express classifies the path as `auth: required` and redirects to `/login?returnTo=…`; after sign-in they are a signed-in viewer below. |
| Signed in, `organizer` true (Manage)     | The admin page.                                                                                                                                   |
| Signed in, `organizer` false (View role) | **Redirect to `/meetings/:id`**, the public page, which applies its own `full_access` tiering. Not a 404 and not an empty page.                   |
| Meeting not found or lookup fails        | `/meetings/not-found`, matching the public page.                                                                                                  |

Today a View-role viewer who reaches `/details` sees the whole participants table (name, email,
organization, job title, committee voting status, attendance, invitation) whenever the upstream read allows it, with none of the
`full_access` checks the public page applies. The redirect closes that gap, which is why FR-054 is a
security change: N-03 ships in its own PR (R06), and whether it waits for the V2 release or goes to
`main` first is the project owner's call.

**The guard is a navigation boundary, not the authorization boundary.** It must not weaken anything
server-side. The write endpoints already enforce organizer in the BFF (reconcile, participant
create / update / delete) or rely on upstream (attachments); N-03 keeps those checks and adds none
that only the client enforces.

## Decision 3 — cross-links

- **Public → admin: yes, one way, organizer-gated, past meetings only.** On an ended meeting where
  `meeting.organizer` is true, the public page offers a single entry point to `/details` (E4-05).
  It uses the same entity-scoped route the card builds (`getEntityCommands(…, 'details')`).
- **Admin → public: no new link.** The admin page keeps its back control. A Manage-role viewer
  reached it from the card or from the public page, and either is one step back.

## Mapping to issues

| Item                                                                                                                                   | Issue                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Fold the roster (§ Public roster fields), attendance bar and filters into public; public → admin link; one source of truth for figures | E4-05 [#3259](https://github.com/linuxfoundation/lfx-self-serve/issues/3259) |
| Recording and transcript on public                                                                                                     | E4-01 [#3255](https://github.com/linuxfoundation/lfx-self-serve/issues/3255) |
| AI summary inline on public                                                                                                            | E4-03 [#3257](https://github.com/linuxfoundation/lfx-self-serve/issues/3257) |
| Public artifact routes (BFF)                                                                                                           | E4-04 [#3258](https://github.com/linuxfoundation/lfx-self-serve/issues/3258) |
| Identity tiers, public vs admin depth                                                                                                  | N-02 [#3264](https://github.com/linuxfoundation/lfx-self-serve/issues/3264)  |
| Guard on `/details` and the outcomes above                                                                                             | N-03 [#3265](https://github.com/linuxfoundation/lfx-self-serve/issues/3265)  |
| Attendance reconciliation, participant writes, future roster administration                                                            | Left on the admin surface. No issue moves them.                              |

## Related

- [Public Meeting Join](./public-meeting-join.md) — the public page's access model and join flows.
- `specs/011-meeting-details-redesign/` — the V2 spec, state matrix (FR-041, FR-054) and rollout plan.

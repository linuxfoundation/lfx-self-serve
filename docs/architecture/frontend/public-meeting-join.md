# Public Meeting Join Page

## 📊 Overview

The public meeting join page (`/meetings/:id`) is a public SSR route that allows both anonymous and authenticated users to view meeting details and join a meeting. It is the primary entry point for invite-link recipients who may not have an LFX account.

**Location:** `apps/lfx-one/src/app/modules/meetings/meeting-join/`

Key files:

- `meeting-join.component.ts` — signals, join flow logic, attachment/registrant gating
- `meeting-join.component.html` — template: badge row, content, join section, signed-out branch

**Backend contracts:** See [Public Meetings](../backend/public-meetings.md) for the server-side M2M auth, controller, and route allowlist details.

---

## 🔐 Access Model

### Current behavior

| Viewer | Meeting type | What they see |
|---|---|---|
| Anonymous | Public, non-restricted | Full title, time, recurrence, agenda; guest-join form |
| Anonymous | Private or restricted (valid password) | Full title, time, recurrence, agenda; guest-join form |
| Anonymous | Private or restricted (missing/wrong password) | `→ /meetings/not-found` |
| Anonymous | Any | No attachments, no members list |
| Authenticated (any) | Any upcoming | Full content; attachments if organizer/invited/member |
| Authenticated (organizer or invited) | Any upcoming | Members drawer enabled |
| Any | Past meeting | Tiered `full_access` gate — see [backend doc](../backend/public-meetings.md) |

### Attachment gating

Attachments for upcoming meetings are fetched via a separate authenticated endpoint (`GET /api/meetings/:uid/attachments`), which is behind `authMiddleware`. The component-side gate in `initializeAttachments` additionally filters the fetch to authenticated sessions only — anonymous viewers never trigger the request, and the template shows "Sign in to view materials for this meeting" when the list is empty and the user is not authenticated.

### Members / registrants gating

The "Show Members" button is only rendered for `authenticated() && (meeting.organizer || meeting.invited)`. Anonymous viewers never see the functional button; the placeholder variant (shown when `meeting.show_meeting_attendees` is set) triggers a "Coming Soon" toast, not a real data fetch.

---

## 🔄 Flows

### Flow 1 — Anonymous, public upcoming meeting

```text
User opens /meetings/:id (no ?password needed)
  ↓
GET /public/api/meetings/:id
  → Server: public + non-restricted short-circuit, returns full meeting
  ↓
Component renders: title, time, recurrence, agenda
  ↓
Signed-out branch: Sign In CTA + OR divider + guest-join form
  ↓
Anonymous submits name/email in guest-join form
  ↓
POST /public/api/meetings/:id/join  (password from meeting.password in payload)
  → Server: validates password, checks join window, returns Zoom URL
  ↓
Browser opens Zoom
```

### Flow 2 — Anonymous, private/restricted upcoming meeting with valid password

```text
User opens /meetings/:id?password=<uuid>  (from invite link)
  ↓
GET /public/api/meetings/:id?password=<uuid>
  → Server: validateMeetingPassword passes, returns full meeting
  ↓
Component renders: title, time, recurrence, agenda
  ↓
Signed-out branch: Sign In CTA + OR divider + guest-join form
  ↓
Anonymous submits guest-join form
  → POST /public/api/meetings/:id/join with password
  → Server: validates password, returns Zoom URL
  ↓
Browser opens Zoom
```

### Flow 3 — Anonymous, restricted meeting (email confirmation required)

```text
User opens /meetings/:id?password=<uuid>
  ↓
GET returns meeting with restricted: true
  ↓
Guest-join form submission → POST /public/api/meetings/:id/join
  → Server: restrictedMeetingCheck — looks up registrant by email or username
    → If not found: 403 error displayed in red banner
    → If found: returns Zoom URL using registrant's stored email
  ↓
Browser opens Zoom
```

### Flow 4 — Anonymous, missing or wrong password on private/restricted

```text
User opens /meetings/:id  (no password, or wrong password)
  ↓
GET /public/api/meetings/:id → Server returns 400 (ServiceValidationError)
  ↓
Client catchError: status 400 → router.navigate(['/meetings/not-found'])
```

### Flow 5 — Authenticated organizer or invited user

```text
User opens /meetings/:id (with or without ?password)
  ↓
GET /public/api/meetings/:id
  → Server: silent login picks up session; addInvitedStatusToMeeting enriches meeting
  → Server: accessCheckService.addAccessToResource sets meeting.organizer
  ↓
Component renders: full content + attachments
  ↓
Join section: "Join Meeting" primary CTA (join URL pre-fetched via meetingService)
  ↓
Members drawer available if organizer || invited
```

### Flow 6 — Past meeting (any viewer)

Past meeting IDs are either a plain numeric ID (fallback after upcoming returns 404) or a `{meetingId}-{timestamp}` format from the occurrence. Access is governed by `checkPastMeetingAccess` — see [backend doc](../backend/public-meetings.md) for the full `full_access` tier logic.

---

## 🧱 Component Structure

**Location:** `apps/lfx-one/src/app/modules/meetings/meeting-join/meeting-join.component.ts`

Key signals and their gating:

| Signal | Type | Gate |
|---|---|---|
| `meeting` | `Signal<Meeting & { project }>` | `toSignal` of `getPublicMeeting` / `getPublicPastMeeting` fallback chain |
| `authenticated` | `WritableSignal<boolean>` | set from `UserService` |
| `password` | `WritableSignal<string\|null>` | set from URL `?password` query param |
| `attachments` | `Signal<MeetingAttachment[]>` | `initializeAttachments` — only fetches when `authenticated()` |
| `materialFiles` | `Signal<MeetingAttachment[]>` | filtered from `attachments` |
| `registrants` | `Signal<MeetingRegistrant[]>` | `initializeRegistrants` — requires `authenticated && (organizer\|\|invited) && !isPastMeeting` |
| `fetchedJoinUrl` | `Signal<string\|undefined>` | `initializeFetchedJoinUrl` — triggers on guest form submission |

**Template structure:**

```html
<lfx-header>
@if (meeting()) {
  badge row (Private / Ended / meeting-type / recurrence)
  copy-link button
  content row (title, context chips, date/time, occurrence nav)
  join section:
    @if (authenticated()) { signed-in branch }
    @else { signed-out branch: Sign In CTA + OR + guest-join form }
  agenda + materials section (gated: !(isPastMeeting && !fullAccess))
  registrants drawer
}
```

---

## 🛡 Server Contract

### GET `/public/api/meetings/:id`

**Location:** `apps/lfx-one/src/server/controllers/public-meeting.controller.ts` → `getMeetingById`

- No authentication required from the caller.
- **Public + non-restricted:** responds immediately with the full meeting object + slim project (name, slug, logo_url, uid, parent_uid). Password not checked.
- **Private or restricted:** validates `?password` query param against `meeting.password` via `validatePassword` (`apps/lfx-one/src/server/utils/security.util.ts`). Missing or wrong password → HTTP 400 (`ServiceValidationError`).
- Response always includes `meeting.password` — the client uses it to build copy-link and returnTo URLs.

### POST `/public/api/meetings/:id/join`

**Location:** `PublicMeetingController.postMeetingLink`

- Validates password unconditionally for all visibilities.
- Validates join-time window (`isWithinJoinWindow`).
- For restricted meetings: `restrictedMeetingCheck` looks up the registrant by email then username. Returns the registrant's stored email for the upstream join-link call.
- Returns `{ link: string }` — the Zoom join URL.

### GET `/public/api/meetings/past/:id`

No password check. `checkPastMeetingAccess` gates full vs. basic field response. See [backend doc](../backend/public-meetings.md).

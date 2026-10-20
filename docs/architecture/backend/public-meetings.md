# Public Meetings Architecture

## 📊 Overview

The public meetings feature allows unauthenticated users to access specific meeting pages, enabling broader participation while maintaining security through optional passcode protection and server-side API authentication.

## 🏗 Architecture Components

### Public Meeting Routes

The system exposes public endpoints that bypass user authentication:

- **Public API Endpoint**: `/public/api/meetings/:id` - Returns meeting and project data
- **Self-Registration Endpoint**: `POST /public/api/meetings/register` - Registers the caller for a public, non-restricted meeting. Mounted on the same optional-auth router, but the handler requires a session of its own — see [Self-Registration Contract](#self-registration-contract-post-publicapimeetingsregister)
- **Materials Endpoints**: `GET /public/api/meetings/:id/attachments` lists the meeting's attachments, and `GET /public/api/meetings/:id/attachments/:attachmentId/download` presigns one file's download. Both sit behind the same gates as `/public/api/meetings/:id` and fail the same way (a missing or wrong passcode is the same 400): a public, unrestricted meeting is open to anonymous visitors; otherwise a registrant (checked by email or username with the M2M token, as the meeting endpoint's invited check matches) or an organizer (checked with the caller's own token, never the M2M identity), or the passcode. The list is read with the M2M token and returned as `PublicMeetingAttachment`, an allowlist without the creator/updater identities or the raw storage URL — files are only reached through the presign route, which answers 404 for a file that is not one of that meeting's, since the presign runs with the M2M token. Every upstream call carries its identity per call (`ApiRequestOptions`, `getMeetingById`'s `bearerToken` option); neither route puts the M2M token on `req.bearerToken`
- **Past-Meeting Artifact Endpoints** (E4-04): `GET /public/api/meetings/past/:id/recording`, `/transcript`, `/transcript/content` and `/summary`, where `:id` is the past meeting's uid. The past meeting is read with the M2M token only to resolve the gate and the artifacts' composite `meeting_and_occurrence_id`. A signed-in caller then reads the artifact with their own token, so upstream FGA decides exactly as on `/api/past-meetings/:uid/*`: each artifact is gated on its own access level (`recording_access` / `transcript_access` / `ai_summary_access`) through the matching `*_viewer` relation, and a summary awaiting approval is the organizer's alone. A caller with no session has no token for upstream to judge, so the BFF decides: only an artifact whose own level is `public`, on a public, unrestricted meeting (`isPastMeetingArtifactPublic`), read with the M2M token. The levels come from the past meeting's `v1_past_meeting` query-service document (`getPastMeetingArtifactAccessLevels`): the ITX read carries only `artifact_visibility`, which is the recording's level, so it never stands in for the others. Only the document whose `id` is the requested past meeting counts; no such document, or an unset level, is not public, as upstream treats an unset level as host-only. Such a caller never gets a summary awaiting approval (404, as for no summary). Every artifact it does get is an allowlist (`toPublicPastMeetingRecording`, `toPublicPastMeetingTranscript`, `toPublicPastMeetingSummary`), and a summary carries only the text in effect (an organizer's edit, never the generated text it replaced), so upstream's host and audit identities, the Zoom summary document link and its password, and anything upstream adds later never reach it. A signed-in caller gets upstream's response unchanged. Anything else is a 401 so the page can offer sign-in. Transcript text keeps `getPastMeetingTranscriptContent`'s 5 MB / 15 s bound. All four are `Cache-Control: private, no-store`
- **Public Roster Endpoint** (E4-04): `GET /public/api/meetings/past/:id/participants` requires a session (401 otherwise), even where artifact access would admit an anonymous caller. A signed-in caller needs artifact access, `checkPastMeetingAccess` with the organizer check run on their own token (403 otherwise); the rows are then read with the M2M token, failing on a partial page walk so the roster is never silently short, and returned as `PublicPastMeetingRoster` (`toPublicPastMeetingRoster`): name, avatar, organization and attended / invited for each verified identity (an invitee who did not attend, or an attendee whose identity is verified), plus a count of every other attendee (unknown, needs review, auto-matched or AI-reconciled; N-02). Never email, job title or committee standing ([Public roster fields](../frontend/meeting-surface-boundary.md#public-roster-fields))
- **Past-Meeting Access Gate**: `checkPastMeetingAccess` passes the M2M token to each membership check per call (registrant, participant, committee member), and checks participation by the composite `meeting_and_occurrence_id` that participant rows are keyed by
- **Frontend Route**: `/meetings/:id` - Displays the meeting page without authentication
- **Access Control**: Meeting visibility levels and optional passcode protection

### Controller Architecture

**Location**: `apps/lfx-one/src/server/controllers/public-meeting.controller.ts`

The public meeting controller handles:

1. **Request Validation**: Validates meeting IDs and parameters
2. **M2M Token Generation**: Creates server-side authentication tokens
3. **Data Fetching**: Retrieves meeting and project information
4. **Access Control**: Enforces visibility rules and passcode requirements
5. **Response Formatting**: Returns appropriate data based on meeting visibility

### Meeting Visibility Levels

The system supports different visibility configurations:

- **PUBLIC**: Fully accessible without authentication or passcode
- **PRIVATE**: Requires passcode for access, limited data exposure
- **RESTRICTED**: Not accessible through public endpoints (future)

## 🔐 Security Architecture

### M2M Authentication for Backend Calls

Public endpoints use machine-to-machine tokens for backend API authentication:

1. **Token Generation**: Server generates M2M token for each request
2. **Token Injection**: Bearer token added to internal API calls
3. **API Authentication**: Backend services receive authenticated requests
4. **User Transparency**: End users don't need authentication

**Implementation**: `apps/lfx-one/src/server/utils/m2m-token.util.ts`

### Passcode Protection

For private meetings:

- **Passcode Validation**: Compares provided passcode with stored Zoom configuration
- **Limited Data Exposure**: Returns only essential project information when passcode-protected
- **Error Handling**: Returns authentication errors for invalid passcodes

### Self-Registration Contract (`POST /public/api/meetings/register`)

The one registrant **write** served from the `/public/api` surface. Being mounted there is not what
decides its auth: the router is `auth: 'optional'`, but the handler rejects an anonymous caller before
any shape check, so the reader of the response is always an authenticated self-registrant.

**Authentication.** `registerForPublicMeeting` requires both `req.oidc.isAuthenticated()` and
`req.bearerToken` — a refresh failure can leave the session flag true with no user token captured, and
this route has to post _as the caller_. It answers `AuthenticationError` first so a prober is told to
sign in rather than walked through the route's field rules. The M2M token this controller mints covers
only the meeting lookup that decides whether the meeting is public and unrestricted; it is swapped back
before the write, which travels under the registrant's own bearer token.

**Inbound allowlist.** `toSelfRegistration` rebuilds the payload key by key from `unknown` rather than
spreading `req.body` — the route mounts the handler bare, with no express-validator. Non-string values
are dropped, free text is trimmed and truncated to `PUBLIC_REGISTRATION_FIELD_MAX_LENGTH`, and the three
identifiers (`meeting_id`, `email`, `occurrence_id`) are trimmed but _rejected_ rather than truncated
when over-length, so an unusable value can never become a different valid-looking one. `host` is forced
to `false` and `committee_uid` is dropped: neither is the caller's to assert.

**Upstream write allowlist.** `MeetingService.addMeetingRegistrantSelf` posts to
`/itx/meetings/:id/registrants/self` with only `first_name`, `last_name`, and the optional `org`,
`job_title` and `occurrence`. It deliberately sends neither `email` nor `username` — the meeting service
reads the registrant's identity off their JWT, which is the whole point of the `self` endpoint. An empty
or missing upstream body falls back to the submitted payload rather than reporting a registrant with
every field blank.

**Response allowlist.** The reply is narrowed to `PUBLIC_SELF_REGISTRATION_RESPONSE_KEYS`
(`packages/shared/src/constants/meeting-registrant.constants.ts`): `uid`, `meeting_id`, `email`,
`first_name`, `last_name`, `host`, `job_title`, `org_name`, `occurrence_id`, `avatar_url`, `created_at`,
`updated_at`. Everything else the upstream row carries — committee attribution, attendance, and the
`created_by` / `updated_by` audit objects, which are nested users rather than identifier strings — is
withheld. The narrowing is about what a person may learn from registering themselves, not about who
reached the endpoint.

The client types the same response off that constant via `PublicMeetingRegistrationResponse`
(`packages/shared/src/interfaces/meeting.interface.ts`), so a server-side narrowing cannot drift from a
client that still believes it holds a full `MeetingRegistrant`. Every key is optional because the
response omits what upstream did not return rather than stating it as `undefined`. Adding a key to the
allowlist is therefore a deliberate two-sided contract change, and it is asserted in
`public-meeting.controller.spec.ts`.

## 📁 Frontend Implementation

### Public Meeting Component

**Location**: `apps/lfx-one/src/app/modules/meetings/meeting.component.ts`

The Angular component handles:

1. **Meeting Display**: Shows meeting details and join options
2. **Authentication Status**: Works for both authenticated and unauthenticated users
3. **Passcode Handling**: Manages passcode input for private meetings
4. **Registration Flow**: Handles meeting registration when required
5. **Error States**: Displays appropriate messages for access restrictions

### Route Configuration

The meeting routes are configured to allow public access:

```typescript
// apps/lfx-one/src/app/app.routes.ts
{
  path: 'meetings/:id',
  loadComponent: () => import('./modules/meetings/meeting.component').then(m => m.MeetingComponent),
}
```

## 🔄 Request Flow

```text
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────▶│  Public Meeting  │────▶│   M2M Token     │
│              │     │   Controller     │     │   Generator     │
└──────────────┘     └──────────────────┘     └─────────────────┘
                              │                         │
                              │                         │
                              ▼                         ▼
                     ┌──────────────────┐     ┌─────────────────┐
                     │ Meeting Service  │◀────│  Auth Provider  │
                     │   (with M2M)     │     │ (Auth0/Authelia)│
                     └──────────────────┘     └─────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │   Backend API    │
                     │   (LFX Service)  │
                     └──────────────────┘
```

## 🔧 Configuration

### Environment Variables

The public meetings feature requires:

- **M2M Authentication**: M2M_AUTH_CLIENT_ID, M2M_AUTH_CLIENT_SECRET
- **API Configuration**: LFX_V2_SERVICE endpoint
- **Auth Provider**: M2M_AUTH_ISSUER_BASE_URL, M2M_AUTH_AUDIENCE

### Middleware Integration

The auth middleware allows public meeting routes to bypass user authentication:

**Location**: `apps/lfx-one/src/server/middleware/auth.middleware.ts`

- Uses `DEFAULT_ROUTE_CONFIG` with an explicit allowlist for public prefixes: `/public/api/meetings` (API) and SPA route `/meetings/:id`
- Bypasses only user–session auth for those allowlisted routes; server-to-server (M2M) calls still require auth
- Applies standard authentication to all other routes (avoid loose regexes like `/meeting.*`)

## 📊 Data Flow

### Public Meeting Request

1. **User Access**: User navigates to `/meetings/:id`
2. **Route Analysis**: Auth middleware allows access with optional authentication
3. **Component Load**: Angular loads meeting component
4. **API Call**: Component requests meeting data from `/public/api/meetings/:id`
5. **M2M Auth**: Server generates M2M token for backend calls
6. **Data Fetch**: Controller retrieves meeting and project data
7. **Access Check**: Validates meeting visibility and passcode if required
8. **Response**: Returns appropriate data based on access level

### Response Structure

The API returns different data based on meeting visibility:

**Public Meetings**:

- Full meeting details
- Complete project information
- Registration options
- Join meeting capabilities

**Private Meetings (with passcode)**:

- Full meeting details after validation
- Limited project information (name, slug, logo)
- Registration restricted based on configuration

## 🎯 Use Cases

### Supported Scenarios

1. **Open Community Meetings**: Public meetings accessible to everyone
2. **Protected Meetings**: Private meetings with passcode sharing
3. **Meeting Discovery**: Users can access meeting details without account
4. **Quick Join**: Direct meeting access without authentication overhead
5. **SEO Benefits**: Public meeting pages indexed by search engines

### Limitations

- **No User Tracking**: Cannot track individual attendees without authentication
- **Limited Personalization**: No user-specific features for public access
- **Registration Constraints**: Some registration types may require authentication

## 🔒 Security Considerations

1. **Data Exposure**: Only non-sensitive meeting data exposed publicly
2. **Rate Limiting**: Public endpoints protected against abuse
3. **Input Validation**: Strict validation of meeting IDs and parameters
4. **Passcode Security**: Passcodes validated server-side only
5. **M2M Token Scope**: Limited permissions for public endpoint tokens

## 📄 Related Documentation

- **[Public Meeting Join Page](../frontend/public-meeting-join.md)** — Frontend component architecture, join flows, attachment/member gating, and guest-join form behavior.

---
type: AngularModule
title: Meetings
description: Meeting scheduling — create, manage, and join meetings with calendar integration
resource: apps/lfx-one/src/app/modules/meetings/
tags: [frontend, angular]
---

## Overview

The Meetings module enables users to discover, create, manage, and join meetings across LFX projects and committees. Users can browse upcoming meetings, register for attendance (RSVP), manage meeting logistics, and access meeting details and artifacts. The module integrates with calendar systems for scheduling and supports role-based access for meeting management.

## Entry Points

- Route: `/meetings` (meetings dashboard)
- Route: `/meetings/create` (create new meeting — requires writer permission)
- Route: `/meetings/:id/edit` (edit meeting details — requires writer permission)
- Route: `/meetings/:id/details` (view past meeting details and artifacts)
- Route: `/meetings/:id/join` (join/access meeting — may require authentication or meeting token)

## Key Components

- `meetings-dashboard/` — Lists upcoming and past meetings
- `meeting-manage/` — Form component for creating and editing meetings
- `meeting-join/` — Meeting access and join interface
- `past-meeting-details/` — View past meeting artifacts (recordings, transcripts, summaries)
- `meeting-not-found/` — Error page for invalid meeting references
- `components/` — Shared meeting UI components

## Backend Surface

- Server route: `apps/lfx-one/src/server/routes/meetings.route.ts`
- Service: [Meeting Service](../services/meeting-service.md)

## Related Concepts

- [Committees](./committees.md) — Meetings may be committee-scoped
- [Events](./events.md) — Meetings are a category of events
- [AI Service](../services/ai-service.md) — Meeting agenda generation
- [Calendar Integration](../architecture/frontend/README.md#calendar-integration) — Meetings can be added to user calendars

# Citations

- Source: `apps/lfx-one/src/app/modules/meetings/`
- Routing: `apps/lfx-one/src/app/modules/meetings/meetings.routes.ts`

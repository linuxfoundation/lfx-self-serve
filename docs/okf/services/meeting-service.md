---
type: Service
title: Meeting Service
description: Manages meeting scheduling, RSVP tracking, registrants, and meeting artifacts including recordings and transcripts.
resource: apps/lfx-one/src/server/services/meeting.service.ts
tags: [backend, express]
---

## Overview

The Meeting Service handles all meeting-related business logic including creation, updates, RSVP management, registrant handling, and access to meeting artifacts (recordings, transcripts, summaries). The service integrates with the upstream `lfx-v2-meeting-service` microservice to manage meeting state and with the `lfx-v2-event-service` for past meeting data. It provides type-safe operations for scheduling, joining, and managing meetings across different meeting types.

## Key Responsibilities

- Create and update meetings with scheduling details
- Manage meeting RSVPs and registrations
- Fetch and manage meeting recordings, transcripts, and summaries
- Handle meeting attachments and presigned downloads
- Retrieve past meeting data and participants
- Support recurring meeting configurations
- Poll endpoints for asynchronous operation resolution

## Dependencies

- Upstream `lfx-v2-meeting-service` microservice
- Upstream `lfx-v2-event-service` microservice for past meetings
- Microservice proxy service for HTTP requests
- Access check service for authorization
- Committee service for committee-associated meeting details
- AI service for meeting agenda generation
- Logger service for structured logging

## Related Concepts

- [AI Service](./ai-service.md) — agenda generation for meetings
- [Committee Service](./committee-service.md) — meetings may be committee-scoped
- [Project Service](./project-service.md) — meetings are scoped to projects
- [Microservice Proxy](../architecture/backend/README.md#microservice-integration) — HTTP proxy pattern

# Citations

- Source: `apps/lfx-one/src/server/services/meeting.service.ts`

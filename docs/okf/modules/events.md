---
type: AngularModule
title: Events
description: Events — browse LFX events and manage attendance
resource: apps/lfx-one/src/app/modules/events/
tags: [frontend, angular]
---

## Overview

The Events module enables users to discover and manage event attendance across the LFX platform. Users can browse upcoming LFX events, view event details, and manage their attendance and registration status. The module provides views for personal event discovery, foundation-wide events, and organization-specific events.

## Entry Points

- Route: `/events` (main events dashboard)
- Route: `/events/foundation` (foundation-wide events — via dashboard routing)
- Route: `/events/org/:uid` (organization-specific events — via dashboard routing)
- Route: `/events/my-events` (user's registered events — via dashboard routing)

## Key Components

- `events-dashboard/` — Main events discovery and browsing interface
- `foundation-event-dashboard/` — Foundation-level event listing
- `my-events-dashboard/` — User's personal event registrations
- `org-events-dashboard/` — Organization-scoped events view
- `components/` — Shared event UI components

## Backend Surface

- Server route: `apps/lfx-one/src/server/routes/events.route.ts`
- Service: Event Service (concept file not in this bundle)

## Related Concepts

- [Meetings](./meetings.md) — Meetings are a type of event
- [Dashboards](./dashboards.md) — Events data surfaces in dashboard contexts

## Citations

- Source: `apps/lfx-one/src/app/modules/events/`
- Routing: `apps/lfx-one/src/app/modules/events/events.routes.ts`

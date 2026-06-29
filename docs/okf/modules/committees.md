---
type: AngularModule
title: Committees
description: Committee management — view, create, and manage project committees
resource: apps/lfx-one/src/app/modules/committees/
tags: [frontend, angular]
---

## Overview

The Committees module provides comprehensive committee management for LFX projects. Users can browse existing committees, create new committees, view committee details, and edit committee configurations. The module supports role-based access, allowing authorized users (writers) to manage committees while other users can view them.

## Entry Points

- Route: `/committees` (committee dashboard)
- Route: `/committees/create` (create new committee — requires writer permission)
- Route: `/committees/:id` (view committee details)
- Route: `/committees/:id/edit` (edit committee — requires writer permission)

## Key Components

- `committee-dashboard/` — Lists all committees and provides overview
- `committee-manage/` — Form component for creating and editing committees
- `committee-view/` — Detailed view of a single committee
- `components/` — Shared UI components for committee features
- `pipes/` — Custom Angular pipes for committee data formatting
- `utils/` — Committee-related utility functions

## Backend Surface

- Server route: `apps/lfx-one/src/server/routes/committees.route.ts`
- Service: [Committee Service](../services/committee-service.md)

## Related Concepts

- [Meetings](./meetings.md) — Committees may host meetings
- [Project Service](../services/project-service.md) — Committees are scoped to projects
- [Auth Guards](../architecture/frontend/README.md#route-guards) — Writer guard controls creation/editing

# Citations

- Source: `apps/lfx-one/src/app/modules/committees/`
- Routing: `apps/lfx-one/src/app/modules/committees/committees.routes.ts`

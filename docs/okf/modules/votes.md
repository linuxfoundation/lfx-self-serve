---
type: AngularModule
title: Votes
description: Voting system — create polls, cast votes, and view results
resource: apps/lfx-one/src/app/modules/votes/
tags: [frontend, angular]
---

## Overview

The Votes module enables users to participate in and manage voting/polling on LFX projects and committees. Users can browse active polls, cast their votes, view results, and (for writers) create and manage voting initiatives. The module supports real-time vote collection and result visualization with role-based access for poll management.

## Entry Points

- Route: `/votes` (votes dashboard)
- Route: `/votes/create` (create new poll/vote — requires writer permission)
- Route: `/votes/:id/edit` (edit poll configuration — requires writer permission)

## Key Components

- `votes-dashboard/` — Lists all active and past votes/polls
- `vote-manage/` — Form component for creating and editing votes
- `components/` — Shared voting UI components

## Backend Surface

- Server route: `apps/lfx-one/src/server/routes/votes.route.ts`
- Service: Vote Service (concept file not in this bundle)

## Related Concepts

- [Committees](./committees.md) — Voting may be used for committee decisions
- [Survey Service](../services/survey-service.md) — Surveys can include voting mechanisms
- [Auth Guards](../../architecture/frontend/README.md#route-guards) — Writer guard controls creation/editing

## Citations

- Source: `apps/lfx-one/src/app/modules/votes/`
- Routing: `apps/lfx-one/src/app/modules/votes/votes.routes.ts`

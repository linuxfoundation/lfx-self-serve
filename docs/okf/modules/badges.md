---
type: AngularModule
title: Badges
description: LFX badges — view and manage credentialing badges earned across projects
resource: apps/lfx-one/src/app/modules/badges/
tags: [frontend, angular]
---

## Overview

The Badges module enables users to browse and manage credentialing badges earned across LFX projects. Users can view their badge achievements and the criteria associated with each badge type within the context of various projects.

## Entry Points

- Route: `/badges` (dashboard view)

## Key Components

- `badges-dashboard/` — Main dashboard for browsing earned badges
- `utils/` — Badge-related utility functions

## Backend Surface

- Server route: `apps/lfx-one/src/server/routes/badges.route.ts`
- Service: [Badge Service](../services/badge-service.md)

## Related Concepts

- [Dashboards](./dashboards.md) — User dashboards contain badge information
- [Project Service](../services/project-service.md) — Badges are scoped to projects

# Citations

- Source: `apps/lfx-one/src/app/modules/badges/`
- Routing: `apps/lfx-one/src/app/modules/badges/badges.routes.ts`

---
type: AngularModule
title: Mailing Lists
description: Mailing list management — subscribe, unsubscribe, and manage lists
resource: apps/lfx-one/src/app/modules/mailing-lists/
tags: [frontend, angular]
---

## Overview

The Mailing Lists module enables users to discover, subscribe to, and manage project and organization mailing lists. Users can browse available lists, manage their subscriptions, view list details, and (for writers) create and edit mailing list configurations. The module supports role-based access, allowing authorized users to manage list settings while subscribers can control their own memberships.

## Entry Points

- Route: `/mailing-lists` (mailing list dashboard)
- Route: `/mailing-lists/create` (create new mailing list — requires writer permission)
- Route: `/mailing-lists/:id` (view mailing list details and manage subscription)
- Route: `/mailing-lists/:id/edit` (edit mailing list configuration — requires writer permission)

## Key Components

- `mailing-list-dashboard/` — Lists all available mailing lists
- `mailing-list-manage/` — Form component for creating and editing lists
- `mailing-list-view/` — Detailed view of a mailing list with subscription management
- `components/` — Shared mailing list UI components

## Backend Surface

- Server route: `apps/lfx-one/src/server/routes/mailing-lists.route.ts`
- Service: [Mailing List Service](../services/mailing-list-service.md)

## Related Concepts

- [Newsletters](./newsletters.md) — Newsletters may use mailing lists for distribution
- [Committees](./committees.md) — Committees may have associated mailing lists
- [Auth Guards](../architecture/frontend/README.md#route-guards) — Writer guard controls creation/editing

# Citations

- Source: `apps/lfx-one/src/app/modules/mailing-lists/`
- Routing: `apps/lfx-one/src/app/modules/mailing-lists/mailing-lists.routes.ts`

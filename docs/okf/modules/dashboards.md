---
type: AngularModule
title: Dashboards
description: Lens-based dashboards (Me, Foundation, Project, Org) and supporting drawers
resource: apps/lfx-one/src/app/modules/dashboards/
tags: [frontend, angular]
---

## Overview

The Dashboards module provides multi-persona dashboard experiences tailored to different user types and organizational contexts. Dashboards are organized by persona (User, Foundation Staff, Executive Director, Board Member, Marketing) and by organizational lens (personal, foundation, project, organization). The module displays aggregated metrics, insights, and contextual information through drawer-based layouts and persona-specific UI variants.

## Entry Points

- Route: `/` (main dashboard — routed by persona and context)
- Route: `/health-metrics` (health and performance metrics)
- Route: `/marketing-impact` (marketing campaign impact analytics)
- Route: `/campaigns` (campaign management and overview)
- Route: `/foundation-projects` (foundation-level project listing)
- Route: `/org/:uid/overview` (organization overview)
- Route: `/org/:uid/memberships` (organization memberships)
- Route: `/org/:uid/projects` (organization projects)
- Route: `/org/:uid/profile` (organization profile)

## Key Components

- `dashboard.component.ts` — Root dashboard component with persona detection and routing
- `user-dashboard/` — Personal dashboard for contributors
- `executive-director/` — ED-specific dashboard view
- `board-member/` — Board member dashboard view
- `multi-persona/` — Multi-persona dashboard router
- `org/` — Organization-scoped dashboard views (overview, memberships, projects, profile)
- `project-dashboard/` — Project-specific dashboard
- `foundation-projects/` — Foundation-level project listing
- `health-metrics/` — Metrics and health indicators
- `marketing-impact/` — Marketing analytics and campaign impact
- `campaigns/` — Campaign overview and management
- `components/` — Reusable dashboard UI components

## Backend Surface

Dashboards primarily consume data from upstream services; route file verification needed (may not have dedicated `dashboards.route.ts`). Data integration happens through:
- [Meeting Service](../services/meeting-service.md) — meeting and RSVP data
- [Committee Service](../services/committee-service.md) — committee overview
- [Project Service](../services/project-service.md) — project metrics and status
- [Newsletter Service](../services/newsletter-service.md) — newsletter analytics

## Related Concepts

- [Authentication](../architecture/frontend/README.md#authentication) — Dashboard persona determined by user role
- [Microservice Proxy](../architecture/backend/README.md#microservice-integration) — Aggregates upstream service data
- All feature modules — dashboards surface data from each module context

# Citations

- Source: `apps/lfx-one/src/app/modules/dashboards/`
- Main component: `apps/lfx-one/src/app/modules/dashboards/dashboard.component.ts`

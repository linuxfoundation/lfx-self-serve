---
type: AngularModule
title: Newsletters
description: Newsletter management — list, manage, and view newsletter analytics
resource: apps/lfx-one/src/app/modules/newsletters/
tags: [frontend, angular]
---

## Overview

The Newsletters module enables authorized users to create, manage, and analyze project newsletters. Users can browse newsletters, view newsletter details, create new newsletters with AI-assisted content generation, edit newsletter configurations, and view analytics on newsletter engagement and performance. The module supports role-based access and separate routing contexts for project vs. foundation newsletters.

## Entry Points

- Route: `/newsletters` (redirects to `/newsletters/list`)
- Route: `/newsletters/list` (browse all accessible newsletters)
- Route: `/newsletters/create` (create new newsletter — requires newsletter access permission)
- Route: `/newsletters/:projectUid/:id/edit` (edit newsletter configuration — requires newsletter access permission)
- Route: `/newsletters/:projectUid/:id/analytics` (view newsletter engagement analytics — requires newsletter access permission)

## Key Components

- `newsletter-list/` — Browse and discover newsletters
- `newsletter-manage/` — Form component for creating and editing newsletters with AI content generation
- `newsletter-analytics/` — Dashboard showing newsletter performance metrics and engagement
- `components/` — Shared newsletter UI components

## Backend Surface

- Server route: `apps/lfx-one/src/server/routes/newsletters.route.ts`
- Service: [Newsletter Service](../services/newsletter-service.md)
- AI Service: [AI Service](../services/ai-service.md) — content generation

## Related Concepts

- [Mailing Lists](./mailing-lists.md) — Newsletters use mailing lists for distribution
- [AI Service](../services/ai-service.md) — Assists with newsletter content generation
- [Snowflake Service](../services/snowflake-service.md) — Analytics data source

## Citations

- Source: `apps/lfx-one/src/app/modules/newsletters/`
- Routing: `apps/lfx-one/src/app/modules/newsletters/newsletters.routes.ts`

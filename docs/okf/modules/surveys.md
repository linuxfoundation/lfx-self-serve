---
type: AngularModule
title: Surveys
description: Survey management — create surveys, collect responses, view NPS analytics
resource: apps/lfx-one/src/app/modules/surveys/
tags: [frontend, angular]
---

## Overview

The Surveys module enables authorized users to create, manage, and analyze surveys for collecting user feedback and gathering Net Promoter Score (NPS) data. Users can browse surveys, create new surveys with customizable questions, edit survey configurations, and view detailed analytics on survey responses and engagement. The module supports role-based access, allowing writers to manage surveys.

## Entry Points

- Route: `/surveys` (surveys dashboard)
- Route: `/surveys/create` (create new survey — requires writer permission)
- Route: `/surveys/:id/edit` (edit survey configuration — requires writer permission)

## Key Components

- `surveys-dashboard/` — Lists all surveys with overview and response summary
- `survey-manage/` — Form component for creating and editing surveys
- `components/` — Shared survey UI components

## Backend Surface

- Server route: `apps/lfx-one/src/server/routes/surveys.route.ts`
- Service: [Survey Service](../services/survey-service.md)

## Related Concepts

- [Snowflake Service](../services/snowflake-service.md) — Survey analytics and response data storage
- [Project Service](../services/project-service.md) — Surveys are scoped to projects
- [Auth Guards](../architecture/frontend/README.md#route-guards) — Writer guard controls creation/editing

# Citations

- Source: `apps/lfx-one/src/app/modules/surveys/`
- Routing: `apps/lfx-one/src/app/modules/surveys/surveys.routes.ts`

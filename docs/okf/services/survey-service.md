---
type: Service
title: Survey Service
description: Manages survey CRUD operations, responses, and NPS analytics via microservice proxy with response tracking.
resource: apps/lfx-one/src/server/services/survey.service.ts
tags: [backend, express]
---

## Overview

The Survey Service handles all survey-related business logic including creation, updates, response collection, and analytics aggregation. It proxies requests to the upstream `lfx-v2-survey-service` microservice and provides type-safe operations for survey management. The service tracks which surveys a user has responded to and stamps response status accordingly in the survey list, enabling the UI to distinguish between responded and unresponded surveys.

## Key Responsibilities

- Create and update surveys with validation
- Fetch surveys and mark response status for current user
- Retrieve survey responses and response records
- Support pagination for survey and response lists
- Generate and manage survey analytics
- Enforce project-level access controls
- Poll endpoints for asynchronous operation resolution
- Validate survey link URLs against an allowlist

## Dependencies

- Upstream `lfx-v2-survey-service` microservice
- Microservice proxy service for HTTP requests
- ETag service for conditional requests
- Project service for project context validation
- Logger service for structured logging
- Query service helpers for pagination

## Related Concepts

- [Project Service](./project-service.md) — surveys are scoped to projects
- [Microservice Proxy](../architecture/backend/README.md#microservice-integration) — HTTP proxy pattern
- [Query Service](../architecture/backend/README.md#pagination) — paginated response handling

# Citations

- Source: `apps/lfx-one/src/server/services/survey.service.ts`

---
type: Service
title: Committee Service
description: Manages committee operations including CRUD, memberships, invitations, and document management via microservice proxy.
resource: apps/lfx-one/src/server/services/committee.service.ts
tags: [backend, express]
---

## Overview

The Committee Service handles all committee-related business logic by proxying requests to the upstream `lfx-v2-committee-service` microservice. It manages committee creation, updates, member management, invitation handling, document uploads, and join applications. The service provides type-safe interfaces for committee operations and handles response polling for asynchronous microservice operations.

The service integrates with access control checks to enforce user authorization and uses the Query Service for fetching paginated committee lists.

## Key Responsibilities

- Create, read, update, and delete committees
- Manage committee members and member roles
- Handle committee invitations and join applications
- Upload and manage committee documents
- Resolve project context and enforce project-level permissions
- Poll microservice endpoints for eventual consistency resolution

## Dependencies

- Upstream `lfx-v2-committee-service` microservice
- Microservice proxy service for HTTP requests
- Access check service for authorization
- Project service for project context validation
- ETag service for conditional requests

## Related Concepts

- [Meeting Service](./meeting-service.md) — meetings may be associated with committees
- [Project Service](./project-service.md) — committees are scoped to projects
- [Microservice Proxy](../architecture/backend/README.md#microservice-integration) — HTTP proxy pattern

# Citations

- Source: `apps/lfx-one/src/server/services/committee.service.ts`

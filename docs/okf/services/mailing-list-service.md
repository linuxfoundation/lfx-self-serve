---
type: Service
title: Mailing List Service
description: Manages mailing list subscriptions, member operations, and Groups.io service integration via microservice proxy.
resource: apps/lfx-one/src/server/services/mailing-list.service.ts
tags: [backend, express]
---

## Overview

The Mailing List Service handles mailing list operations and subscriptions with support for the Groups.io provider. It proxies requests to the upstream `lfx-v2-mailing-list-service` microservice and provides business logic for member management, subscription state transitions, and list operations. The service enforces project-level permissions and handles eventual consistency with polling strategies.

## Key Responsibilities

- Fetch and manage mailing lists for projects
- Subscribe and unsubscribe users from mailing lists
- Manage mailing list member properties and moderation states
- Create and manage Groups.io service configurations
- Poll endpoints for asynchronous operation resolution
- Enforce project-level access controls

## Dependencies

- Upstream `lfx-v2-mailing-list-service` microservice
- Microservice proxy service for HTTP requests
- Access check service for authorization
- Project service for project context validation
- Query service for paginated resource fetching

## Related Concepts

- [Microservice Proxy](../../architecture/backend/README.md#microservice-integration) — HTTP proxy pattern
- [Access Control](../../architecture/backend/README.md#authorization) — project-level permissions enforcement

## Citations

- Source: `apps/lfx-one/src/server/services/mailing-list.service.ts`

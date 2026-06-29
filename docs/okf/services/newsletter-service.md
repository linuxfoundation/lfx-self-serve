---
type: Service
title: Newsletter Service
description: Thin proxy layer for newsletter operations delegating to the lfx-v2-newsletter-service Go microservice.
resource: apps/lfx-one/src/server/services/newsletter.service.ts
tags: [backend, express]
---

## Overview

The Newsletter Service is a thin pass-through layer that delegates all newsletter business logic to the upstream `lfx-v2-newsletter-service` microservice. The service exposes a unified interface for newsletter CRUD operations, sending, recipient counting, analytics retrieval, and test sending. The Go service owns recipient resolution, email-chrome rendering, per-recipient fan-out to `lfx-v2-email-service`, and analytics aggregation. The Express layer provides a single collaborator for controllers without additional business logic.

## Key Responsibilities

- Create, read, update, and delete newsletters
- Send drafted newsletters via the upstream service
- Count newsletter recipients based on filters
- Fetch recipient lists for preview
- Retrieve newsletter analytics
- Execute test sends to validate newsletter content
- Delegate authentication and authorization to upstream service

## Dependencies

- Upstream `lfx-v2-newsletter-service` microservice (Go service)
- Newsletter Service Client for typed HTTP proxy calls
- Microservice proxy service for HTTP requests
- Logger service (via delegated client)

## Related Concepts

- [Newsletter Service Client](./newsletter-service.md#related-source) — typed HTTP wrapper for Go service calls
- [AI Service](./ai-service.md) — may provide draft content generation
- [Email Service](../architecture/backend/README.md#external-services) — downstream recipient delivery
- [Project Service](./project-service.md) — newsletters are scoped to projects

# Citations

- Source: `apps/lfx-one/src/server/services/newsletter.service.ts`
- Client Source: `apps/lfx-one/src/server/services/newsletter-service.client.ts`

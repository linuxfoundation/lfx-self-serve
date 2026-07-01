---
type: Service
title: NATS Service
description: Manages NATS pub/sub and request-reply messaging for inter-service communication within the LFX microservices ecosystem.
resource: apps/lfx-one/src/server/services/nats.service.ts
tags: [backend, express]
---

## Overview

The NATS Service provides a high-performance messaging interface for inter-service communication using NATS (Neural Autonomic Transport System). It implements lazy connection management with automatic reconnection and request-reply patterns for synchronous communication between the LFX One application and other microservices. The service uses the NATS `nats.js` client library with StringCodec for message encoding/decoding and integrates with OpenTelemetry tracing for observability.

## Key Responsibilities

- Establish and manage NATS server connections with lazy initialization
- Send and receive messages using the request-reply pattern
- Encode/decode messages using StringCodec
- Implement request timeouts and error handling
- Provide graceful shutdown with connection draining
- Track connection health and provide monitoring data

## Dependencies

- NATS server (Kubernetes cluster service: `lfx-platform-nats.lfx.svc.cluster.local:4222`)
- `nats.js` client library for NATS protocol
- OpenTelemetry tracer for distributed tracing
- Logger service for structured logging

## Related Concepts

- [Auth Service](./auth-service.md) — fetches user identities via NATS auth-service
- [NATS Integration](../../architecture/backend/nats-integration.md) — architecture patterns and configuration

## Citations

- Architecture: `docs/architecture/backend/nats-integration.md`
- Source: `apps/lfx-one/src/server/services/nats.service.ts`

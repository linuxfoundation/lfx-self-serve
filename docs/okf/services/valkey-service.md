---
type: Service
title: Valkey Service
description: Provides cross-instance, fail-soft in-memory cache backed by Valkey with lazy connection and Redis-compatible API.
resource: apps/lfx-one/src/server/services/valkey.service.ts
tags: [backend, express]
---

## Overview

The Valkey Service implements a distributed cache layer backed by Valkey (Redis-compatible in-memory data store) with a fail-soft, lazy-connect architecture that never blocks startup or requests. The service uses the `ioredis` library to connect to Valkey and implements the `CachePort` interface. When `VALKEY_URL` is unset, caching is disabled and callers degrade gracefully with direct-fetch fallback. Connection errors are logged and never crash the process — the cache operates in degraded mode as best-effort.

## Key Responsibilities

- Provide singleton cross-instance cache accessor
- Read JSON values from cache with shape validation
- Write JSON values to cache with TTL
- Implement fail-soft behavior — never block or crash on cache errors
- Validate cached values against caller-provided shape predicates
- Log cache events (hits, misses, degradation) without blocking
- Clean up gracefully on shutdown
- Redact sensitive cache keys from logs

## Dependencies

- Valkey cluster (Redis-compatible; disabled when `VALKEY_URL` unset)
- `ioredis` npm package for Redis client
- Logger service for structured logging (errors logged but never blocking)

## Related Concepts

- [Cache Port](../../architecture/shared/package-architecture.md#interfaces) — service interface contract
- [Shutdown Hooks](../../architecture/backend/README.md#lifecycle) — graceful cleanup pattern

## Citations

- Source: `apps/lfx-one/src/server/services/valkey.service.ts`

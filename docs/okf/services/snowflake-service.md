---
type: Service
title: Snowflake Service
description: Provides read-only analytical query access to Snowflake DBT data warehouse with connection pooling and query deduplication.
resource: apps/lfx-one/src/server/services/snowflake.service.ts
tags: [backend, express]
---

## Overview

The Snowflake Service manages read-only analytical queries against the Snowflake DBT data warehouse with enterprise-grade security and performance optimization. It implements a singleton connection pool using the Snowflake SDK, multi-layer SQL injection protection via parameterized queries, query deduplication to prevent duplicate execution of identical queries, and a circuit breaker pattern for degraded service handling. The service uses private key JWT authentication and enforces read-only query validation at multiple layers.

## Key Responsibilities

- Establish and manage Snowflake connection pools with configurable sizing
- Execute parameterized SELECT queries with SQL injection prevention
- Deduplicate identical concurrent queries to reduce resource utilization
- Validate queries are read-only at both code and pattern-matching levels
- Monitor connection pool health and utilization metrics
- Implement circuit breaker pattern for service degradation
- Support authentication via private key (file or environment variable)

## Dependencies

- Snowflake Data Cloud (account, warehouse, database, and role)
- Snowflake SDK (`snowflake-sdk` npm package)
- Lock Manager utility for query deduplication
- OpenTelemetry tracer for distributed tracing
- Logger service for structured logging

## Related Concepts

- [Lock Manager](../architecture/backend/snowflake-integration.md#query-deduplication) — query deduplication strategy
- [Snowflake Integration](../architecture/backend/snowflake-integration.md) — architecture patterns and security layers
- [Analytics Controllers](../architecture/backend/README.md#analytics) — primary callers for data access

# Citations

- Architecture: `docs/architecture/backend/snowflake-integration.md`
- Source: `apps/lfx-one/src/server/services/snowflake.service.ts`

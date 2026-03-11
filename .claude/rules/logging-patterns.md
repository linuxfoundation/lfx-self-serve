---
description: Pino structured logging patterns — logger service API, layer responsibilities, log levels, code examples
globs: '**/server/**'
---

# Logging System

## Architecture Overview

- **Base Logger**: `serverLogger` created in `server-logger.ts` — base Pino instance with all configuration
- **HTTP Logger**: `pinoHttp` middleware uses `serverLogger` as base, creates `req.log` for each request
- **Logger Service**: Singleton service (`logger.service.ts`) — unified interface for all application logging
- **Format**: Structured JSON logs with Pino for AWS CloudWatch compatibility

## Logger Service Pattern (Primary Interface)

**Import and Usage:**

```typescript
import { logger } from './logger.service';

// In controllers/routes with request context:
const startTime = logger.startOperation(req, 'operation_name', metadata);
logger.success(req, 'operation_name', startTime, metadata);

// In services/utilities without request context:
const startTime = logger.startOperation(undefined, 'nats_connect', metadata);
logger.success(undefined, 'nats_connect', startTime, metadata);
```

**Available Methods:**

- `logger.startOperation(req|undefined, 'operation', metadata, options?)` — Returns startTime; DEBUG for request-scoped, INFO for infrastructure (silent option available)
- `logger.success(req|undefined, 'operation', startTime, metadata)` — DEBUG for reads (GET/HEAD/OPTIONS), INFO for writes (POST/PUT/DELETE/PATCH), INFO for infrastructure
- `logger.error(req|undefined, 'operation', startTime, error, metadata, options?)` — Logs at ERROR with 'err' field
- `logger.info(req|undefined, 'operation', message, metadata)` — Logs at INFO for significant operations
- `logger.warning(req|undefined, 'operation', message, metadata)` — Logs at WARN (also used for validation errors per ADR 0002)
- `logger.debug(req|undefined, 'operation', message, metadata)` — Logs at DEBUG
- `logger.etag(req|undefined, 'operation', resourceType, resourceId, etag?, metadata)` — Logs ETag operations

**When to Use Each Pattern:**

- **Request-scoped** (pass `req`): Controllers, route handlers, service methods called from routes
- **Infrastructure** (pass `undefined`): NATS connections, Snowflake pool, server startup/shutdown, scheduled jobs

## Logging Layer Responsibility

**Controllers (HTTP Boundary):**

- Always use `logger.startOperation()` / `logger.success()` / `logger.error()` for HTTP operations
- Operation names should match HTTP semantics (e.g., `get_meeting_rsvps`, `create_meeting`)
- Duration represents full HTTP request to response cycle
- One startOperation per HTTP endpoint

**Services (Business Logic):**

- Always use `logger.debug()` for step-by-step tracing
- Use `logger.info()` for significant business operations visible in production:
  - Data transformations (V1 to V2 conversions)
  - Data enrichment (adding project names, committee data)
  - Complex multi-step orchestrations
  - Operations with notable business impact
- Use `logger.warning()` for recoverable errors when returning null/empty arrays
- Never use `logger.startOperation()` with the same operation name as the calling controller
- Never call `serverLogger` directly

**Why This Pattern:**

- Prevents duplicate logging (no double startOperation calls)
- Clear separation: Controllers log HTTP, Services log business logic
- Production visibility: INFO logs for significant operations, DEBUG for detailed tracing
- Consistent duration semantics: HTTP duration in controllers, not inflated by double-counting

## Error Logging Standard

**Always use `err` field** for proper error serialization:

```typescript
// CORRECT
logger.error(req, 'operation', startTime, error, metadata);
logger.error(undefined, 'operation', startTime, error, metadata);

// INCORRECT
serverLogger.error({ error: error.message }, 'message'); // Don't use serverLogger directly
req.log.error({ error: error }, 'message'); // Should use logger service
{
  error: error.message;
} // Loses stack trace
```

**Benefits:**

- Complete stack traces in production/debug
- Clean single-line errors in development
- Proper AWS CloudWatch format
- Custom serializer: `/server/helpers/error-serializer.ts`

## Log Level Guidelines (ADR 0002)

The logger service automatically selects correct log levels based on HTTP method.
See [ADR 0002](https://github.com/linuxfoundation/lfx-architecture-decisions/blob/main/decisions/0002-structured-json-logging.md) for the full decision.

**Method-aware log levels in `startOperation` / `success`:**

| Scenario                          | `startOperation` | `success` | `error` |
| --------------------------------- | ---------------- | --------- | ------- |
| **Read** (GET/HEAD/OPTIONS)       | DEBUG            | DEBUG     | ERROR   |
| **Write** (POST/PUT/DELETE/PATCH) | DEBUG            | INFO      | ERROR   |
| **Infrastructure** (no `req`)     | INFO             | INFO      | ERROR   |

This means: 0 INFO lines for read endpoints, 1 INFO line for write endpoints, always ERROR for failures.

**INFO** — Write completions and significant business operations:

- **In Controllers**: Automatically emitted by `logger.success()` for write requests only
- **In Services**: Significant business operations visible in production (via `logger.info()`):
  - Data transformations (V1 to V2 conversions)
  - Data enrichment (project names, committee data)
  - Complex orchestrations
  - Operations with notable business impact

**WARN** — Recoverable issues and invalid user input:

- Validation errors from user input (logged by `apiErrorHandler` via `getSeverity()`)
- Error conditions with graceful degradation (returning null/empty arrays)
- Data quality issues, user not found
- Fallback behaviors, NATS failures with graceful handling
- Service errors that don't propagate to controller

**DEBUG** — Internal operations, tracing, and read endpoints:

- **In Controllers**: Read endpoint start/success (automatically via `startOperation` / `success`)
- **In Services**: Step-by-step operation tracing
- Method entry/exit with key parameters
- Preparation steps (sanitizing, creating payload)
- Internal lookups (NATS, database queries)
- Simple data fetches
- Infrastructure operations (connections, pool state)

**ERROR** — Critical failures:

- **In Controllers**: HTTP operation failures (via `logger.error()` with startTime)
- System failures, unhandled exceptions
- Critical errors requiring immediate attention
- Operations that cannot continue
- **NOT** for validation errors (handled at WARN by `apiErrorHandler`)

## Features

- **Deduplication**: Prevents duplicate logs for same operation (request-scoped only)
- **Duration Tracking**: Automatic calculation from startTime to completion
- **Request Correlation**: `request_id` field for tracing (when req provided)
- **Sensitive Data Redaction**: Automatic redaction of tokens, auth headers, cookies
- **AWS Trace ID**: Automatic capture from Lambda environment
- **Filtered URLs**: Health checks (`/health`, `/api/health`) and `/.well-known` not logged

## Logging Architecture

```text
server-logger.ts (breaks circular dependency)
  └─ Creates and exports serverLogger (base Pino instance)
      └─ Configuration: levels, serializers, formatters, redaction

server.ts
  ├─ Imports serverLogger from server-logger.ts
  └─ Creates httpLogger (pinoHttp middleware)
      └─ Uses serverLogger as base
      └─ Attaches req.log to each request

logger.service.ts
  ├─ Imports serverLogger from server-logger.ts
  └─ Singleton logger service
      ├─ Request-scoped: uses req.log when req provided
      ├─ Infrastructure: uses serverLogger when req = undefined
      └─ Provides unified API for all logging
```

**Direct serverLogger Usage:**

- Never call `serverLogger` directly from services/routes/controllers
- Always use `logger` service methods
- `serverLogger` only exists in `server-logger.ts` (created), `server.ts` (imported), and `logger.service.ts` (imported)

## Common Logging Patterns

**Controller/Route Handler Pattern:**

```typescript
export const getUser = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'get_user', { userId: req.params.id });

  try {
    const user = await userService.getUserById(req, req.params.id);

    logger.success(req, 'get_user', startTime, { userId: user.id });
    return res.json(user);
  } catch (error) {
    logger.error(req, 'get_user', startTime, error, { userId: req.params.id });
    return next(error);
  }
};
```

**Service Method — Simple (DEBUG only):**

```typescript
public async getUserById(req: Request, userId: string): Promise<User> {
  logger.debug(req, 'get_user_by_id', 'Fetching user from database', { userId });

  const user = await this.database.findUser(userId);

  return user;
}
```

**Service Method — Complex (INFO + DEBUG):**

```typescript
public async getMeetings(req: Request, query: QueryParams): Promise<Meeting[]> {
  logger.debug(req, 'get_meetings', 'Starting meeting fetch', { query });

  const { resources } = await this.microserviceProxy.proxyRequest(...);

  logger.debug(req, 'get_meetings', 'Fetched resources', { count: resources.length });

  // Significant transformation - use INFO level for production visibility
  if (isV1) {
    logger.info(req, 'transform_v1_meetings', 'Transforming V1 meetings to V2 format', {
      count: resources.length,
    });
    meetings = meetings.map(transformV1MeetingToV2);
  }

  // Enrichment step - DEBUG for tracing
  logger.debug(req, 'get_meetings', 'Enriching with project names', { count: meetings.length });
  meetings = await this.enrichWithProjects(req, meetings);

  // Significant enrichment - use INFO level
  if (meetings.some((m) => m.committees?.length > 0)) {
    logger.info(req, 'enrich_committees', 'Enriching meetings with committee data', {
      total_meetings: meetings.length,
    });
    meetings = await this.getMeetingCommittees(req, meetings);
  }

  logger.debug(req, 'get_meetings', 'Completed meeting fetch', { final_count: meetings.length });

  return meetings;
}
```

**Service Method — Graceful Error Handling:**

```typescript
public async getPastMeetingRecording(req: Request, meetingUid: string): Promise<Recording | null> {
  logger.debug(req, 'get_past_meeting_recording', 'Fetching recording', { meeting_uid: meetingUid });

  try {
    const { resources } = await this.microserviceProxy.proxyRequest(...);

    if (!resources || resources.length === 0) {
      logger.warning(req, 'get_past_meeting_recording', 'No recording found', {
        meeting_uid: meetingUid,
      });
      return null;
    }

    return resources[0].data;
  } catch (error) {
    logger.warning(req, 'get_past_meeting_recording', 'Failed to fetch recording, returning null', {
      meeting_uid: meetingUid,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}
```

**Infrastructure Operation (No Request Context):**

```typescript
public async connect(): Promise<void> {
  const startTime = logger.startOperation(undefined, 'db_connect', { host: this.config.host });

  try {
    await this.pool.connect();
    logger.success(undefined, 'db_connect', startTime, { poolSize: this.pool.size });
  } catch (error) {
    logger.error(undefined, 'db_connect', startTime, error, { host: this.config.host });
    throw error;
  }
}
```

**Internal Service Operation (Called from method with req):**

```typescript
// Parent method has req
public async getProjectBySlug(req: Request, slug: string): Promise<Project> {
  return this.fetchFromNats(req, slug); // Pass req down
}

// Internal method receives req for logging correlation
private async fetchFromNats(req: Request, slug: string): Promise<Project> {
  logger.debug(req, 'fetch_from_nats', 'Fetching project from NATS', { slug });
  // ... implementation
}
```

## Logging Checklist

**Before logging:**

- [ ] Using `logger` service, not `serverLogger` directly?
- [ ] Passing `req` if available, `undefined` if infrastructure?
- [ ] Using `err` field for errors (not `error`)?
- [ ] Appropriate log level (INFO/WARN/DEBUG/ERROR)?
- [ ] Operation name in snake_case?
- [ ] Sensitive data sanitized?

**For Controllers:**

- [ ] Using `logger.startOperation()` for HTTP operations?
- [ ] Calling `logger.success()` or `logger.error()` with `startTime`?
- [ ] Not duplicating service-level logging?

**For Services:**

- [ ] Using `logger.debug()` for step-by-step tracing?
- [ ] Using `logger.info()` for significant operations (transformations, enrichments)?
- [ ] Using `logger.warning()` for graceful error handling (returning null/empty)?
- [ ] NOT using `logger.startOperation()` if controller already logs the same operation?
- [ ] Passing relevant metadata for debugging?

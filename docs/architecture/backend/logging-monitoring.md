# Logging & Monitoring

## 📝 Overview

The application uses a structured logging system built on Pino with operation lifecycle tracking, CloudWatch optimization, and automatic duplicate prevention. All logging is handled through the singleton `LoggerService` class, which supports both request-scoped operations (with `req`) and infrastructure operations (without `req`).

## 🏗️ LoggerService Architecture

### Singleton Pattern with Operation Tracking

The `LoggerService` is a singleton class that provides consistent, structured logging across the entire application:

```typescript
// Import the singleton instance
import { logger } from '../services/logger.service';

// Use in controllers and services
const startTime = logger.startOperation(req, 'fetch_projects', { filter: 'active' });
// ... perform operation
logger.success(req, 'fetch_projects', startTime, { count: projects.length });
```

### Key Features

- **Operation Lifecycle Tracking**: Pairs `startOperation()` → `success()`/`error()` for complete operation visibility
- **Automatic Duration Calculation**: Computes `duration_ms` via `Date.now() - startTime`
- **Duplicate Prevention**: Tracks logged errors to prevent duplicate logs in error middleware (request-scoped only)
- **CloudWatch Optimization**: Structured metadata for efficient AWS CloudWatch queries
- **Memory Safety**: WeakMap-based operation tracking prevents memory leaks
- **Error Serialization**: Custom serializer for clean error output in dev and detailed traces in production
- **Dual Mode Support**: Works with request context (`req`) or without (`undefined`) for infrastructure operations

### Logging Architecture Layers

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
  └─ Singleton LoggerService
      ├─ When req provided: uses req.log (request-scoped)
      ├─ When req = undefined: uses serverLogger (infrastructure)
      └─ Provides unified API for all logging
```

**Import Pattern:**

- ✅ Controllers/Services: `import { logger } from './logger.service'`
- ❌ Never import `serverLogger` directly (except in server.ts and logger.service.ts)

## 📊 Logging Methods

### Operation Lifecycle Methods

#### `startOperation(req | undefined, operation, metadata, options)`

Starts an operation and returns `startTime` for duration tracking.

```typescript
// Request-scoped operation
const startTime = logger.startOperation(req, 'create_meeting', {
  project_uid: projectId,
  meeting_type: 'board',
});

// Infrastructure operation (no request context)
const startTime = logger.startOperation(undefined, 'nats_connect', {
  url: natsUrl,
});
```

**Parameters:**

- `req`: Express Request object, or `undefined` for infrastructure operations (NATS, Snowflake, shutdown)
- `operation`: Snake_case operation name (e.g., `create_meeting`, `fetch_user_profile`, `nats_connect`)
- `metadata`: Contextual data (avoid sensitive information)
- `options`: Optional configuration
  - `silent`: If true, doesn't log the start (for silent tracking)

**Returns:** `number` - startTime for use with success/error calls

**Log Level:** DEBUG for request-scoped, INFO for infrastructure (unless `silent: true`)

#### `success(req | undefined, operation, startTime, metadata)`

Marks an operation as successful and logs with duration.

```typescript
// Request-scoped
logger.success(req, 'create_meeting', startTime, {
  meeting_uid: newMeeting.uid,
});

// Infrastructure
logger.success(undefined, 'nats_connect', startTime, {
  pool_size: connection.pool.size,
});
```

**Parameters:**

- `req`: Express Request object, or `undefined` for infrastructure operations
- `operation`: Same operation name from startOperation
- `startTime`: Value returned from startOperation
- `metadata`: Success-specific data (results, counts, IDs)

**Log Level:** Method-aware — DEBUG for reads (GET/HEAD/OPTIONS), INFO for writes (POST/PUT/DELETE/PATCH), INFO for infrastructure

**Output Example (write operation):**

```json
{
  "level": "INFO",
  "operation": "create_meeting",
  "status": "success",
  "duration_ms": 145,
  "meeting_uid": "abc123",
  "msg": "Operation completed successfully"
}
```

#### `error(req | undefined, operation, startTime, error, metadata, options)`

Marks an operation as failed and logs error details.

```typescript
try {
  const meeting = await getMeeting(id);
  logger.success(req, 'fetch_meeting', startTime, { meeting_uid: id });
} catch (error) {
  logger.error(req, 'fetch_meeting', startTime, error, {
    meeting_uid: id,
    attempted_action: 'fetch',
  });
  throw error;
}
```

**Parameters:**

- `req`: Express Request object, or `undefined` for infrastructure operations
- `operation`: Same operation name from startOperation
- `startTime`: Value returned from startOperation
- `error`: Error object or unknown error
- `metadata`: Error-specific context
- `options`: Optional configuration
  - `skipIfLogged`: If true, skips logging if already logged (for error middleware, request-scoped only)

**Log Level:** ERROR

**Output Example:**

```json
{
  "level": "ERROR",
  "operation": "fetch_meeting",
  "status": "failed",
  "duration_ms": 52,
  "err": {
    "type": "ResourceNotFoundError",
    "message": "Meeting not found",
    "stack": "Error: Meeting not found\n    at MeetingService.getMeeting..."
  },
  "meeting_uid": "xyz789",
  "msg": "Operation failed"
}
```

### Informational Logging Methods

#### `debug(req | undefined, operation, message, metadata)`

Logs debug-level information for development and troubleshooting.

```typescript
// Request-scoped
logger.debug(req, 'committee_member_lookup', 'Checking committee membership', {
  username,
  category: 'Board',
});

// Infrastructure
logger.debug(undefined, 'snowflake_pool', 'Pool connection acquired', {
  active_connections: pool.size,
});
```

**When to Use:**

- Internal operation steps that don't need lifecycle tracking
- Informational logging within loops
- Intermediate processing steps
- Infrastructure state logging
- Development troubleshooting

**Log Level:** DEBUG

#### `warning(req | undefined, operation, message, metadata)`

Logs warning-level information for concerning but non-critical issues.

```typescript
// Request-scoped
logger.warning(req, 'token_refresh', 'Token refresh failed - user needs re-authentication', {
  err: error,
  path: req.path,
});

// Infrastructure
logger.warning(undefined, 'nats_connect', 'NATS connection slow', {
  connection_time_ms: 5000,
});
```

**When to Use:**

- Recoverable errors that don't fail the operation
- Data quality issues
- Fallback behavior activation
- User not found scenarios
- Token refresh failures
- Infrastructure performance issues

**Log Level:** WARN

## 🎯 Log Level Guidelines (ADR 0002)

The logger service automatically selects correct log levels based on HTTP method. See [ADR 0002](https://github.com/linuxfoundation/lfx-architecture-decisions/blob/main/decisions/0002-structured-json-logging.md) for the full decision.

### Method-Aware Log Levels

The `startOperation` and `success` methods automatically choose the correct log level:

| Scenario                          | `startOperation` | `success` | `error` |
| --------------------------------- | ---------------- | --------- | ------- |
| **Read** (GET/HEAD/OPTIONS)       | DEBUG            | DEBUG     | ERROR   |
| **Write** (POST/PUT/DELETE/PATCH) | DEBUG            | INFO      | ERROR   |
| **Infrastructure** (no `req`)     | INFO             | INFO      | ERROR   |

This means: 0 INFO lines for read endpoints, 1 INFO line for write endpoints, always ERROR for failures.

### ERROR

**When:** Critical failures requiring immediate attention

- **In Controllers**: HTTP operation failures (via `logger.error()` with startTime)
- System failures, unhandled exceptions
- Operations that cannot continue
- **NOT** for validation errors (handled at WARN by `apiErrorHandler`)

### WARN

**When:** Recoverable issues and invalid user input

- Validation errors from user input (logged by `apiErrorHandler` via `getSeverity()`)
- Error conditions with graceful degradation (returning null/empty arrays)
- Data quality issues, user not found
- Fallback behaviors, NATS failures with graceful handling
- Service errors that don't propagate to controller

### INFO

**When:** Write completions and significant business operations

- **In Controllers**: Automatically emitted by `logger.success()` for write requests only
- **In Services**: Significant business operations visible in production (via `logger.info()`):
  - Data transformations (V1 to V2 conversions)
  - Data enrichment (project names, committee data)
  - Complex orchestrations
  - Operations with notable business impact

### DEBUG

**When:** Internal operations, tracing, and read endpoints

- **In Controllers**: Read endpoint start/success (automatically via `startOperation` / `success`)
- **In Services**: Step-by-step operation tracing
- Method entry/exit with key parameters
- Preparation steps (sanitizing, creating payload)
- Internal lookups (NATS, database queries)
- Simple data fetches
- Infrastructure operations (connections, pool state)

## 🔄 Operation Lifecycle Patterns

### Standard Controller Pattern

Controllers own HTTP lifecycle logging (`startOperation` → `success`/`error`). Validation errors are handled by throwing structured errors — the `apiErrorHandler` middleware logs them at the appropriate level (WARN for validation, ERROR for system failures).

```typescript
export class MeetingController {
  public async createMeeting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'create_meeting', {
      project_uid: req.body.project_uid,
      meeting_type: req.body.type,
    });

    try {
      // Perform operation (validation handled by helpers that throw on failure)
      const meeting = await meetingService.createMeeting(req, req.body);

      // Log success — automatically INFO for writes, DEBUG for reads
      logger.success(req, 'create_meeting', startTime, {
        meeting_uid: meeting.uid,
        attendee_count: meeting.attendees?.length || 0,
      });

      res.status(201).json(meeting);
    } catch (error) {
      // Log error — apiErrorHandler will skip if already logged here
      logger.error(req, 'create_meeting', startTime, error, {
        project_uid: req.body.project_uid,
      });
      next(error);
    }
  }
}
```

### Service Layer Pattern

Services use `debug()` for step-by-step tracing, `info()` for significant business operations, and `warning()` for graceful error handling. Services should **not** use `startOperation()`/`success()` — controllers own the HTTP lifecycle and duration tracking.

```typescript
export class MeetingService {
  public async getMeetingById(req: Request, meetingId: string): Promise<Meeting> {
    logger.debug(req, 'get_meeting_by_id', 'Fetching meeting from upstream', { meeting_id: meetingId });

    const meeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', `/meetings/${meetingId}`, 'GET');

    if (!meeting) {
      throw new ResourceNotFoundError('Meeting', meetingId, {
        operation: 'get_meeting_by_id',
      });
    }

    return meeting;
  }

  public async getMeetings(req: Request, query: QueryParams): Promise<Meeting[]> {
    logger.debug(req, 'get_meetings', 'Starting meeting fetch', { query });

    const { resources } = await this.microserviceProxy.proxyRequest(...);

    // Significant transformation — use INFO for production visibility
    if (isV1) {
      logger.info(req, 'transform_v1_meetings', 'Transforming V1 meetings to V2 format', {
        count: resources.length,
      });
      meetings = meetings.map(transformV1MeetingToV2);
    }

    logger.debug(req, 'get_meetings', 'Completed meeting fetch', { final_count: meetings.length });
    return meetings;
  }

  public async getRecording(req: Request, meetingUid: string): Promise<Recording | null> {
    logger.debug(req, 'get_recording', 'Fetching recording', { meeting_uid: meetingUid });

    try {
      const { resources } = await this.microserviceProxy.proxyRequest(...);
      if (!resources?.length) {
        // Graceful error — use warning, return null
        logger.warning(req, 'get_recording', 'No recording found', { meeting_uid: meetingUid });
        return null;
      }
      return resources[0].data;
    } catch (error) {
      logger.warning(req, 'get_recording', 'Failed to fetch recording, returning null', {
        meeting_uid: meetingUid,
        err: error,
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}
```

### Informational Logging (No Lifecycle)

```typescript
// Use debug() for informational logging without lifecycle tracking
for (const [category, persona] of Object.entries(COMMITTEE_CATEGORY_TO_PERSONA)) {
  logger.debug(req, 'check_committee_category', 'Checking category', { category });

  const memberships = await committeeService.getCommitteeMembersByCategory(req, username, category);

  logger.debug(req, 'committee_memberships_retrieved', 'Found memberships', {
    category,
    count: memberships.length,
  });
}
```

## 🚨 Error Handling & Duplicate Prevention

### Controller-Level Error Logging

Controllers log errors before passing them to middleware:

```typescript
try {
  // ... operation
} catch (error) {
  logger.error(req, 'operation_name', startTime, error, metadata);
  next(error); // Pass to error middleware
}
```

### Error Middleware with Severity-Based Logging

The error middleware uses `getSeverity()` to log at the correct level per ADR 0002 — validation errors log at WARN, system errors at ERROR:

```typescript
export function apiErrorHandler(error: Error, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const operation = getOperationFromPath(req.path);
  const startTime = logger.getOperationStartTime(req, operation) || Date.now();

  if (isBaseApiError(error)) {
    const logLevel = error.getSeverity();
    const logContext = {
      error_type: error.code,
      status_code: error.statusCode,
      ...error.getLogContext(),
      request_id: req.id,
      path: req.path,
      method: req.method,
    };

    if (logLevel === 'error') {
      // Skip if already logged by controller
      logger.error(req, operation, startTime, error, logContext, { skipIfLogged: true });
    } else if (logLevel === 'warn') {
      // Validation errors log at WARN, not ERROR (ADR 0002)
      logger.warning(req, operation, `API error: ${error.message}`, { ...logContext, err: error });
    } else {
      logger.debug(req, operation, `API error: ${error.message}`, { ...logContext, err: error });
    }

    res.status(error.statusCode).json({ ...error.toResponse(), path: req.path });
    return;
  }

  // Unhandled errors always log at ERROR
  logger.error(
    req,
    operation,
    startTime,
    error,
    {
      error_type: 'unhandled',
      path: req.path,
      method: req.method,
    },
    { skipIfLogged: true }
  );
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', path: req.path });
}
```

### How Duplicate Prevention Works

1. Controller logs error: `logger.error(req, 'create_meeting', startTime, error, metadata)`
2. LoggerService marks operation as "logged" in WeakMap
3. Error middleware tries to log: `logger.error(req, operation, Date.now(), error, metadata, { skipIfLogged: true })`
4. LoggerService checks if already logged → skips if true
5. Result: Single error log, no duplicates

## ⏱️ Duration Tracking

### Correct Usage

```typescript
// ✅ CORRECT: Capture startTime, use for duration calculation
const startTime = logger.startOperation(req, 'fetch_meetings');
// ... operation
logger.success(req, 'fetch_meetings', startTime, { count });
```

### Incorrect Usage

```typescript
// ❌ WRONG: startTime=0 causes incorrect duration (time since epoch)
logger.error(req, 'ssr_render', 0, error, metadata);
// Results in duration_ms: 1702915200000 (millions of milliseconds!)

// ✅ CORRECT: Use Date.now() if no operation was started
logger.error(req, 'ssr_render', Date.now(), error, metadata);
// Results in duration_ms: 0 (acceptable for error-only logging)
```

### SSR Error Handler Example

```typescript
app.use('/**', async (req: Request, res: Response, next: NextFunction) => {
  const ssrStartTime = Date.now(); // Capture at handler start

  // ... SSR operations

  angularApp.handle(req, { auth }).catch((error) => {
    // Use captured startTime for accurate duration
    logger.error(req, 'ssr_render', ssrStartTime, error, {
      code: error.code,
      url: req.url,
    });
  });
});
```

## 🔧 Base Pino Configuration

### Server Logger (Base Logger)

Defined in `server-logger.ts` with whitelist-based serializers to prevent sensitive data leakage:

```typescript
// apps/lfx-one/src/server/server-logger.ts
export const serverLogger = pino(
  {
    level: process.env['LOG_LEVEL'] || 'info',
    base: {
      service: 'lfx-one-ssr',
      environment: process.env['NODE_ENV'] || 'development',
      version: process.env['APP_VERSION'] || '1.0.0',
    },
    mixin: () => {
      // Capture AWS X-Ray trace ID if available
      const traceHeader = process.env['_X_AMZN_TRACE_ID'];
      if (traceHeader) {
        const traceId = traceHeader.split(';')[0]?.replace('Root=', '');
        return { aws_trace_id: traceId };
      }
      return {};
    },
    serializers: {
      err: customErrorSerializer,
      error: customErrorSerializer,
      req: reqSerializer, // Whitelist-based — only safe fields
      res: resSerializer, // Whitelist-based — statusCode only
    },
    redact: {
      paths: ['access_token', 'refresh_token', 'authorization', 'cookie'],
      remove: true,
    },
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  prettyStream // Pretty-printed in dev, raw JSON in production
);
```

### HTTP Logger Middleware

The pinoHttp middleware inherits serializers from the base `serverLogger`:

```typescript
// apps/lfx-one/src/server/server.ts
const httpLogger = pinoHttp({
  logger: serverLogger, // Inherits serializers, formatters, redaction from base
  serializers: {
    err: customErrorSerializer,
    error: customErrorSerializer,
    req: reqSerializer,
    res: resSerializer,
  },
  autoLogging: false, // LoggerService handles operation logging
});

app.use(httpLogger);
```

### Custom Error Serializer

Includes stack traces in development and when DEBUG logging is enabled. Production logs omit stacks for cleaner CloudWatch output:

```typescript
// apps/lfx-one/src/server/helpers/error-serializer.ts
export const customErrorSerializer = (err: any) => {
  if (!err) return err;

  const serialized: any = {
    type: err.constructor?.name || err.name || 'Error',
    message: err.message || String(err),
  };

  if (err.code) serialized.code = err.code;
  if (err.statusCode) serialized.statusCode = err.statusCode;
  if (err.status) serialized.status = err.status;

  // Stack traces in dev or when debug logging is enabled
  if (process.env['NODE_ENV'] !== 'production' || process.env['LOG_LEVEL'] === 'debug') {
    serialized.stack = err.stack;
  }

  // Preserve custom error properties
  Object.keys(err).forEach((key) => {
    if (!['message', 'stack', 'name', 'constructor'].includes(key)) {
      serialized[key] = err[key];
    }
  });

  return serialized;
};
```

## 📈 CloudWatch Optimization

### Structured Metadata

```typescript
// ✅ Good: Structured for CloudWatch filtering
logger.success(req, 'fetch_meetings', startTime, {
  project_uid: 'abc123',
  meeting_type: 'board',
  count: 5,
  duration_ms: 142,
});

// Enables CloudWatch queries like:
// fields @timestamp, operation, duration_ms, project_uid
// | filter operation = "fetch_meetings"
// | filter duration_ms > 1000
// | stats avg(duration_ms) by project_uid
```

### Operation Naming Convention

Use snake_case for operation names to ensure CloudWatch compatibility:

```typescript
// ✅ Good
logger.startOperation(req, 'create_committee_member');
logger.startOperation(req, 'fetch_user_profile');
logger.startOperation(req, 'update_meeting_attendees');

// ❌ Bad
logger.startOperation(req, 'createCommitteeMember'); // camelCase
logger.startOperation(req, 'fetch-user-profile'); // kebab-case
```

## 🔒 Security & Redaction

### Automatic Redaction

The following fields are automatically redacted via Pino's `redact` config:

- `access_token`
- `refresh_token`
- `authorization`
- `cookie`

Additionally, whitelist-based serializers prevent sensitive data leakage:

- **Request serializer** (`reqSerializer`): Only emits `id`, `method`, `url`, `remoteAddress`, `userAgent` — no headers, cookies, or auth data
- **Response serializer** (`resSerializer`): Only emits `statusCode` — no `set-cookie` or other response headers

### Safe Metadata Practices

```typescript
// ✅ Good: No sensitive data
logger.success(req, 'user_login', startTime, {
  username: user.username,
  login_method: 'oauth',
});

// ❌ Bad: Contains sensitive data
logger.success(req, 'user_login', startTime, {
  username: user.username,
  password: user.password, // Never log passwords
  access_token: token.value, // Will be redacted but shouldn't be included
});
```

## 📊 Health Check Filtering

Health check endpoints are excluded from automatic HTTP logging:

```typescript
// Health check endpoint (added before logger middleware)
app.get('/health', (_req: Request, res: Response) => {
  res.send('OK');
});

// HTTP logger middleware (added after health endpoint)
app.use(httpLogger);
```

URLs excluded from logging:

- `/health`
- `/api/health`
- `/.well-known/*`

## 🎯 Best Practices

### DO ✅

1. **Always pair operations**: Every `startOperation()` must have a corresponding `success()` or `error()` call
2. **Capture startTime properly**: Store the return value from `startOperation()`
3. **Use correct methods**: `startOperation` for lifecycle, `debug()` for informational
4. **Include context**: Add relevant metadata for troubleshooting
5. **Follow naming conventions**: Use snake_case for operation names
6. **Use err field**: Always pass errors to the `error` parameter, not in metadata

### DON'T ❌

1. **Don't use startTime=0**: This causes incorrect duration calculations
2. **Don't use startOperation in loops**: Use `debug()` for repeated informational logs
3. **Don't use startOperation/success in services**: Services use `debug()`/`info()`/`warning()` — controllers own the lifecycle
4. **Don't log validation errors at ERROR**: They're WARN (handled by `apiErrorHandler` via `getSeverity()`)
5. **Don't log sensitive data**: Never log passwords, tokens, or PII
6. **Don't skip error handling**: Always log errors before throwing/passing to middleware

### Code Review Checklist

- [ ] All `startOperation()` calls are paired with `success()` or `error()`
- [ ] `startOperation()`/`success()` only used in controllers, not services
- [ ] startTime is captured and used correctly (not 0)
- [ ] Services use `debug()` for tracing, `info()` for significant operations
- [ ] Error middleware uses `{ skipIfLogged: true }`
- [ ] Validation errors handled at WARN, not ERROR
- [ ] No sensitive data in log metadata
- [ ] Operation names use snake_case
- [ ] Errors use `err` parameter, not metadata fields

## 🔧 Environment Configuration

```bash
# Log level (trace, debug, info, warn, error, fatal)
LOG_LEVEL=info

# Node environment (affects error stack traces)
NODE_ENV=production

# AWS X-Ray trace ID (auto-injected in AWS environments)
_X_AMZN_TRACE_ID=Root=1-67890-abc123
```

## 📊 What's Implemented

- LoggerService singleton with operation lifecycle tracking (startOperation → success/error)
- Method-aware log levels per ADR 0002 (reads at DEBUG, writes at INFO)
- Duplicate log prevention via WeakMap-based tracking
- CloudWatch-optimized structured logging with automatic duration calculation
- Whitelist-based req/res serializers to prevent sensitive data leakage
- Custom error serializer with environment-aware stack traces
- Validation errors logged at WARN by `apiErrorHandler` via `getSeverity()`

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
server-logger.ts (NEW - breaks circular dependency)
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

**Log Level:** INFO (unless `silent: true`)

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

**Log Level:** INFO

**Output Example:**

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

#### `validation(req | undefined, operation, errors, metadata)`

Logs validation failures with detailed error context.

```typescript
logger.validation(req, 'create_meeting', ['Missing required field: title'], {
  provided_fields: Object.keys(req.body),
});
```

**When to Use:**

- Request validation failures
- Missing required fields
- Invalid field formats
- Business rule violations

**Log Level:** WARN

## 🎯 Log Level Guidelines

### ERROR

**When:** System failures requiring immediate attention
**Examples:**

- Database connection failures
- External service unavailable
- Unhandled exceptions
- Data corruption

### WARN

**When:** Concerning issues that don't break functionality
**Examples:**

- Validation failures
- Token refresh failures
- User not found
- Fallback behaviors
- Data quality issues

### INFO

**When:** Business operation completions
**Examples:**

- Resource created/updated/deleted
- Successful data retrieval
- Operation start (via startOperation)
- Operation success

### DEBUG

**When:** Internal operations and development info
**Examples:**

- Intermediate processing steps
- Loop iterations
- Intent statements ("fetching", "resolving")
- Authentication checks
- Route classification

## 🔄 Operation Lifecycle Patterns

### Standard Controller Pattern

```typescript
export class MeetingController {
  public async createMeeting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'create_meeting', {
      project_uid: req.body.project_uid,
      meeting_type: req.body.type,
    });

    try {
      // Validate request
      const validationErrors = validateMeetingInput(req.body);
      if (validationErrors.length > 0) {
        logger.validation(req, 'create_meeting', validationErrors, {
          provided_fields: Object.keys(req.body),
        });
        return res.status(400).json({ errors: validationErrors });
      }

      // Perform operation
      const meeting = await meetingService.createMeeting(req, req.body);

      // Log success
      logger.success(req, 'create_meeting', startTime, {
        meeting_uid: meeting.uid,
        attendee_count: meeting.attendees?.length || 0,
      });

      res.status(201).json(meeting);
    } catch (error) {
      // Log error (error middleware will see skipIfLogged)
      logger.error(req, 'create_meeting', startTime, error, {
        project_uid: req.body.project_uid,
      });
      next(error);
    }
  }
}
```

### Service Layer Pattern

```typescript
export class MeetingService {
  public async getMeetingById(req: Request, meetingId: string): Promise<Meeting> {
    // Silent operation tracking for service-level operations
    const startTime = logger.startOperation(req, 'get_meeting_by_id', { meeting_id: meetingId }, { silent: true });

    try {
      const meeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', `/meetings/${meetingId}`, 'GET');

      if (!meeting) {
        throw new ResourceNotFoundError('Meeting', meetingId, {
          operation: 'get_meeting_by_id',
        });
      }

      logger.success(req, 'get_meeting_by_id', startTime, {
        meeting_uid: meetingId,
      });

      return meeting;
    } catch (error) {
      logger.error(req, 'get_meeting_by_id', startTime, error, {
        meeting_id: meetingId,
      });
      throw error;
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

### Error Middleware with Duplicate Prevention

The error middleware uses `skipIfLogged` to prevent duplicate logs:

```typescript
export function apiErrorHandler(error: Error, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const operation = getOperationFromPath(req.path);

  if (isBaseApiError(error)) {
    const logLevel = error.getSeverity();

    if (logLevel === 'error') {
      // Skip if already logged by controller
      logger.error(req, operation, Date.now(), error, logContext, { skipIfLogged: true });
    }
    // ... send response
  }
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

```typescript
// apps/lfx-one/src/server/server.ts
const serverLogger = pino({
  level: process.env['LOG_LEVEL'] || 'info',
  base: {
    service: 'lfx-one-ssr',
    environment: process.env['NODE_ENV'] || 'development',
  },
  serializers: {
    err: customErrorSerializer, // Clean dev logs, detailed prod logs
    error: customErrorSerializer,
  },
  redact: {
    paths: ['access_token', 'refresh_token', 'authorization', 'cookie'],
    remove: true,
  },
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

### HTTP Logger Middleware

```typescript
const httpLogger = pinoHttp({
  logger: serverLogger,
  autoLogging: false, // LoggerService handles operation logging
  serializers: {
    err: customErrorSerializer,
    error: customErrorSerializer,
  },
  level: process.env['LOG_LEVEL'] || 'info',
});

app.use(httpLogger);
```

### Custom Error Serializer

```typescript
// apps/lfx-one/src/server/helpers/error-serializer.ts
export const customErrorSerializer = (err: Error): Record<string, unknown> => {
  const isDev = process.env['NODE_ENV'] !== 'production';

  return {
    type: err.constructor.name,
    message: err.message,
    ...(err.stack && !isDev && { stack: err.stack }), // Stack in prod/debug only
    ...(err.cause && { cause: err.cause }),
  };
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

The following fields are automatically redacted:

- `access_token`
- `refresh_token`
- `authorization`
- `cookie`
- Request headers: `authorization`, `cookie`
- Response headers: `set-cookie`

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
3. **Don't log sensitive data**: Never log passwords, tokens, or PII
4. **Don't nest ternaries in logs**: Keep log statements simple and readable
5. **Don't skip error handling**: Always log errors before throwing/passing to middleware

### Code Review Checklist

- [ ] All `startOperation()` calls are paired with `success()` or `error()`
- [ ] startTime is captured and used correctly (not 0)
- [ ] Informational logs use `debug()` instead of `startOperation()`
- [ ] Error middleware uses `{ skipIfLogged: true }`
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

## 📈 Current Implementation Status

### ✅ Implemented

- LoggerService singleton with operation tracking
- Operation lifecycle (startOperation → success/error)
- Duplicate log prevention
- Duration calculation
- CloudWatch-optimized structured logging
- Custom error serializer
- Security redaction
- Health check filtering
- Validation logging
- WeakMap-based memory safety

### 🔲 Not Implemented

- Log aggregation service integration
- Metrics collection endpoints
- Performance monitoring dashboards
- Alert system integration
- Automated log retention policies

This logging system provides comprehensive operation visibility, efficient CloudWatch integration, and prevents common logging issues like duplicates and incorrect durations.

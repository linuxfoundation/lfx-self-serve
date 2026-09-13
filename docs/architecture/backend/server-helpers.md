<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Server Helpers

## Overview

Server helpers are pure utility functions located in `apps/lfx-one/src/server/helpers/`. They provide reusable logic for validation, pagination, error handling, and security across controllers and services.

All helpers follow consistent patterns: stateless functions, request parameter for logging correlation, generic types for reusability, and integration with the `logger` service singleton.

## Helper Categories

The helpers directory contains files organized by responsibility:

| File                         | Purpose                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-gateway.helper.ts`      | API Gateway base URL resolution (`getApiGatewayBaseUrl`, `getUserServiceBaseUrl`)                                                                                                                                                                                                                                                       |
| `error-serializer.ts`        | Pino error serializer configuration                                                                                                                                                                                                                                                                                                     |
| `formation-mapper.helper.ts` | Maps upstream `lfx-v2-formation-service` shapes (checklist, items) onto the BFF's `@lfx-one/shared` formation types — queue-row normalization (`sub_stage`, GH-2366) instead lives in `packages/shared/src/utils/formation.utils.ts`'s `normalizeFormationSubStage`/`getFormationQueueStageDisplay`, called from `formation.service.ts` |
| `http-status.helper.ts`      | HTTP status code to message/code mappings                                                                                                                                                                                                                                                                                               |
| `ics.helper.ts`              | iCalendar (`.ics`) generation for meeting invites                                                                                                                                                                                                                                                                                       |
| `meeting.helper.ts`          | Meeting invitation checks with M2M tokens                                                                                                                                                                                                                                                                                               |
| `poll-endpoint.helper.ts`    | Generic retry/polling with callback injection                                                                                                                                                                                                                                                                                           |
| `query-service.helper.ts`    | Cursor-based pagination with automatic page following                                                                                                                                                                                                                                                                                   |
| `root-project.helper.ts`     | TTL-cached ROOT-project uid resolution and `parent_uid` collapse for top-level projects                                                                                                                                                                                                                                                 |
| `url-validation.ts`          | URL and cookie domain validation with allowlists                                                                                                                                                                                                                                                                                        |
| `validation.helper.ts`       | TypeScript type guard validators for request parameters                                                                                                                                                                                                                                                                                 |

## Common Patterns

### Request Parameter for Logging

Most helpers accept `req: Request` as their first parameter for logging correlation:

```typescript
async function helper(req: Request, entityId: string): Promise<Result> {
  logger.debug(req, 'operation_name', 'Processing entity', { entity_id: entityId });
  // ...
}
```

Infrastructure helpers that run outside request context accept `req: Request | undefined`:

```typescript
async function helper(req: Request | undefined, operation: string): Promise<boolean> {
  logger.debug(req, operation, 'Starting operation');
  // ...
}
```

Security utilities that should not log sensitive data omit the request parameter entirely.

### Callback Injection

Helpers accept functions as parameters to stay decoupled from specific services:

```typescript
export async function fetchAllQueryResources<T>(req: Request, fetchPage: (pageToken?: string) => Promise<QueryServiceResponse<T>>): Promise<T[]> {
  // Helper handles pagination logic
  // Caller provides the actual API call
}
```

The caller provides the implementation:

```typescript
const data = await fetchAllQueryResources<Meeting>(req, (pageToken) =>
  this.microserviceProxy.proxyRequest(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
    type: 'v1_meeting',
    page_size: 100,
    ...(pageToken && { page_token: pageToken }),
  })
);
```

### Options Object Pattern

For functions with multiple optional parameters, use an options interface:

```typescript
export interface PollEndpointOptions {
  req: Request | undefined;
  operation: string;
  pollFn: () => Promise<boolean>;
  maxRetries?: number;
  retryDelayMs?: number;
  metadata?: Record<string, unknown>;
}

export async function pollEndpoint(options: PollEndpointOptions): Promise<boolean> {
  const { req, operation, pollFn, maxRetries = 5, retryDelayMs = 2000, metadata = {} } = options;
  // ...
}
```

### Generic Type Parameters

Helpers use TypeScript generics to work with any data type:

```typescript
export async function fetchAllQueryResources<T>(req: Request, fetchPage: (pageToken?: string) => Promise<QueryServiceResponse<T>>): Promise<T[]>;
```

### Type Guard Functions

Validation helpers return TypeScript type predicates that narrow types in the calling code:

```typescript
export function validateUidParameter(uid: string | undefined, req: Request, next: NextFunction, options: ValidationOptions): uid is string {
  if (!uid || uid.trim() === '') {
    next(
      ServiceValidationError.forField('uid', 'UID is required', {
        /* ... */
      })
    );
    return false;
  }
  return true;
}
```

Usage in controllers:

```typescript
const startTime = logger.startOperation(req, 'get_entity', { uid });

if (!validateUidParameter(uid, req, next, { operation: 'get_entity', logStartTime: startTime })) {
  return; // TypeScript knows uid is undefined here
}

// TypeScript knows uid is string here
const entity = await service.getById(req, uid);
```

## Error Handling Patterns

### Fail-Safe Return

Security and URL helpers return `null` on any validation failure:

```typescript
export const validateAndSanitizeUrl = (url: string, allowedDomains?: string[]): string | null => {
  if (!url || typeof url !== 'string') return null;
  try {
    // Validation logic
    return parsedUrl.toString();
  } catch {
    return null;
  }
};
```

### Next Callback Propagation

Validation helpers pass errors to Express `next()` for centralized error handling:

```typescript
if (!isValid) {
  const error = ServiceValidationError.forField(fieldName, message, context);
  next(error);
  return false;
}
```

### Retry with Selective Error Classification

The query service helper retries only on 5xx server errors:

```typescript
function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const statusCode = (error as any).statusCode ?? (error as any).status;
    return typeof statusCode === 'number' && statusCode >= 500;
  }
  return false;
}
```

## Validation Helper Reference

The validation helper provides five type guard functions sharing a common interface:

```typescript
interface ValidationOptions {
  operation: string;
  service?: string;
  logStartTime?: number;
}
```

| Function                       | Validates                                         | Type Predicate      |
| ------------------------------ | ------------------------------------------------- | ------------------- |
| `validateUidParameter`         | Non-empty string UID                              | `uid is string`     |
| `validateItemKeyParameter`     | Formation `item_key` shape (lowercase snake_case) | `itemKey is string` |
| `validateRequiredParameter<T>` | Non-null/undefined/empty value                    | `value is T`        |
| `validateArrayParameter<T>`    | Non-empty array                                   | `array is T[]`      |
| `validateRequestBody<T>`       | Non-empty request body                            | `body is T`         |

All validators:

- Log the error if `logStartTime` is provided
- Create a `ServiceValidationError` with field-specific context
- Call `next(error)` for Express error handling
- Return `false` to signal invalid input

## Guidelines

- **Use `logger` service** — never import `serverLogger` directly
- **Keep helpers pure** — no shared mutable state. Narrow exception: `root-project.helper.ts`'s
  module-level TTL cache for the ROOT project's uid — there is exactly one such value per
  environment, losing it costs one extra NATS round-trip rather than any correctness, and a test
  reset hook (`resetRootProjectUidCacheForTests`) keeps specs isolated. Don't extend this exception
  to helpers caching per-request or per-entity data.
- **Accept `req` for correlation** — pass it through from controllers
- **Return defaults on error** — prefer graceful degradation over throwing
- **Use generics** — make helpers reusable across different data types
- **Document with JSDoc** — explain parameters and usage for each exported function

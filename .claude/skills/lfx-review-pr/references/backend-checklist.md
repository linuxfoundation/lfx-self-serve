# Backend Review Checklist

Express.js backend review standards. Each item includes severity and a brief violation/fix example.

---

## 1. Three-file pattern (SHOULD FIX)

Every endpoint needs three files: service, controller, route.

- `services/<name>.service.ts` — business logic, API calls, data transformation
- `controllers/<name>.controller.ts` — HTTP handling (parse req, validate, send res)
- `routes/<name>.route.ts` — route definitions wiring controllers to paths

**Violation:** Business logic in controller or HTTP handling in service.
**Fix:** Split into the three-file pattern above.

---

## 2. Controller-Service separation (SHOULD FIX)

Controllers handle HTTP concerns only. Services handle business logic only.

**Violation:**

```typescript
// In controller — doing business logic
export const getUser = async (req, res, next) => {
  const data = await apiClient.get('/users/' + req.params.id);
  const transformed = { ...data, fullName: data.first + ' ' + data.last };
  res.json(transformed);
};
```

**Fix:**

```typescript
// Controller — HTTP only
export const getUser = async (req, res, next) => {
  const startTime = logger.startOperation(req, 'get_user', { userId: req.params.id });
  try {
    const user = await userService.getUserById(req, req.params.id);
    logger.success(req, 'get_user', startTime, { userId: user.id });
    return res.json(user);
  } catch (error) {
    return next(error);
  }
};

// Service — business logic
public async getUserById(req: Request, userId: string): Promise<User> {
  logger.debug(req, 'get_user_by_id', 'Fetching user', { userId });
  const data = await this.microserviceProxy.proxyRequest(...);
  return { ...data, fullName: data.first + ' ' + data.last };
}
```

---

## 3. Logging: bare next(error) (CRITICAL)

Controller catch blocks must use bare `next(error)`. NEVER call `logger.error()` before `next(error)` -- `apiErrorHandler` middleware logs centrally.

**Violation:**

```typescript
catch (error) {
  logger.error(req, 'get_user', startTime, error, {});
  next(error);
}
```

**Fix:**

```typescript
catch (error) {
  return next(error);
}
```

**Exception:** Controllers that handle their own response in the catch block (e.g., SSE streaming with `res.end()`) must log errors themselves since `apiErrorHandler` is never reached.

---

## 4. Logger service usage (SHOULD FIX)

Always use `logger` from `logger.service.ts`. Never import `serverLogger` directly. Never use `console.log`.

**Violation:**

```typescript
import { serverLogger } from '../server-logger';
serverLogger.info({ msg: 'something' });
console.log('debug:', data);
```

**Fix:**

```typescript
import { logger } from '../services/logger.service';
logger.info(req, 'operation', 'Something happened', { data });
```

---

## 5. Controller logging lifecycle (SHOULD FIX)

Controllers must follow this pattern:

1. `logger.startOperation(req, 'operation_name', metadata)` at start -- returns `startTime`
2. `logger.success(req, 'operation_name', startTime, metadata)` on success
3. Operation names in `snake_case` matching HTTP semantics

**Violation:**

```typescript
export const createMeeting = async (req, res, next) => {
  try {
    const result = await meetingService.create(req, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
```

**Fix:**

```typescript
export const createMeeting = async (req, res, next) => {
  const startTime = logger.startOperation(req, 'create_meeting', {
    projectId: req.body.projectId,
  });
  try {
    const result = await meetingService.create(req, req.body);
    logger.success(req, 'create_meeting', startTime, { meetingId: result.id });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
```

---

## 6. Service logging (SHOULD FIX)

Services use different log levels for different purposes:

| Method                     | When to use                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- |
| `logger.debug(req, ...)`   | Step-by-step tracing, method entry/exit, internal lookups                       |
| `logger.info(req, ...)`    | Significant operations: transformations, enrichments, multi-step orchestrations |
| `logger.warning(req, ...)` | Graceful errors: returning null/empty, fallback behavior                        |

**Violation:**

```typescript
logger.info(req, 'get_meetings', 'Fetching meetings from upstream', {});
// INFO for a simple fetch is too noisy
```

**Fix:**

```typescript
logger.debug(req, 'get_meetings', 'Fetching meetings from upstream', {});
// DEBUG for tracing, reserve INFO for significant operations
```

---

## 7. getEffectiveEmail(req) (CRITICAL)

For user identity, always use `getEffectiveEmail(req)` from `auth-helper`. Never access the OIDC user email directly.

**Violation:**

```typescript
const email = req.oidc?.user?.['email'];
const email = req.oidc?.user?.email;
```

**Fix:**

```typescript
import { getEffectiveEmail } from '../utils/auth-helper';
const email = getEffectiveEmail(req);
```

This is required for impersonation support -- `getEffectiveEmail` checks for impersonation context before falling back to the OIDC session email.

---

## 8. Custom error classes (SHOULD FIX)

Use the project's custom error classes from `server/errors/`. No raw `new Error()` or manual `res.status().json()` for errors.

**Violation:**

```typescript
throw new Error('User not found');
return res.status(400).json({ error: 'Invalid input' });
```

**Fix:**

```typescript
import { ServiceValidationError } from '../errors/service-validation.error';
import { AuthenticationError } from '../errors/authentication.error';
import { MicroserviceError } from '../errors/microservice.error';

throw ServiceValidationError.forField('email', 'Invalid email format');
throw new AuthenticationError('Token expired');
throw MicroserviceError.fromMicroserviceResponse(response);
```

---

## 9. M2M token restrictions (CRITICAL)

M2M tokens only for:

- Public endpoints where no user session exists (e.g., public meeting pages)
- Explicit privileged upstream calls after user authorization is validated in-app

**Violations:**

- Using M2M token in a protected route to skip user authorization
- Replacing user bearer token with M2M token for normal API calls
- Not restoring user auth context after a privileged upstream call

**Fix:** Default to user bearer token (`req.bearerToken`). Only use M2M for the specific upstream call that requires it, and restore user context immediately after.

---

## 10. Upstream API contract validation (CRITICAL)

The LFX One backend is a thin proxy layer. New or modified proxy endpoints MUST match the upstream microservice contract.

**Validate with:**

```bash
gh api repos/linuxfoundation/<repo>/contents/gen/http/openapi3.yaml --jq '.content' | base64 -d
```

**Check that:** paths exist, HTTP methods match, request/response shapes match, query params are correct.

**Upstream repo map:**

| Domain        | Repo                        |
| ------------- | --------------------------- |
| Queries       | lfx-v2-query-service        |
| Projects      | lfx-v2-project-service      |
| Meetings      | lfx-v2-meeting-service      |
| Mailing Lists | lfx-v2-mailing-list-service |
| Committees    | lfx-v2-committee-service    |
| Voting        | lfx-v2-voting-service       |
| Surveys       | lfx-v2-survey-service       |

---

## 11. Protected files (NIT -- flag for awareness)

Changes to these files should be flagged for extra scrutiny. They are core infrastructure and affect the entire application:

**Server core:**

- `server.ts`, `server-logger.ts`
- `middleware/*` (auth, error-handler)

**Singleton services:**

- `logger.service.ts`
- `microservice-proxy.service.ts`
- `nats.service.ts`
- `snowflake.service.ts`

**Configuration:**

- `app.routes.ts`
- `package.json`, `yarn.lock`
- `CLAUDE.md`

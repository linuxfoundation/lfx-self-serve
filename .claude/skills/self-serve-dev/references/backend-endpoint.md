<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Backend Endpoint Reference

## Three-File Pattern

Every backend endpoint creates three files: **service** → **controller** → **route**.

The upstream API contract should already be validated in Step 3 of the develop skill. Use the confirmed endpoint paths, request/response schemas, and query parameters when building the proxy layer below.

---

## Service (`src/server/services/<name>.service.ts`)

- Uses `MicroserviceProxyService` for ALL external API calls
- API reads: `/query/resources`, writes: `/itx/...`
- **Authentication: Default to the user's bearer token** (passed via `req.bearerToken` from the OIDC session) for all authenticated routes. Only use M2M tokens when the upstream service requires service credentials **and** the route has already enforced authorization using the user token (for example, privileged upstream reads that temporarily swap `req.bearerToken` to an M2M token and then restore it). For public endpoints (`/public/api/...`) with no user session, use M2M tokens. See the "Authentication: User Tokens vs M2M Tokens" section in development rules.
- `logger.debug()` for step-by-step tracing, `logger.info()` for significant operations
- `logger.warning()` for recoverable errors (returning null/empty)
- NEVER use `serverLogger` directly — always use `logger` from `./services/logger.service`

### Service Example Pattern

```typescript
import { QueryServiceResponse, PaginatedResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

class MyService {
  private microserviceProxy: MicroserviceProxyService;

  constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  public async getItems(req: Request, query: Record<string, any> = {}): Promise<PaginatedResponse<Item>> {
    logger.debug(req, 'get_items', 'Fetching items from upstream', { query });

    const { resources, page_token } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Item>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      ...query,
      type: 'my_items',
    });

    const items = resources.map((r: any) => r.data);
    logger.debug(req, 'get_items', 'Fetched items', { count: items.length });
    return { data: items, page_token };
  }

  public async createItem(req: Request, payload: Partial<Item>): Promise<Item> {
    logger.debug(req, 'create_item', 'Creating item', { payload });

    const result = await this.microserviceProxy.proxyRequest<Item>(req, 'LFX_V2_SERVICE', '/itx/items', 'POST', payload);

    return result;
  }
}

export const myService = new MyService();
```

---

## Controller (`src/server/controllers/<name>.controller.ts`)

- `logger.startOperation()` → `try/catch` → `logger.success()` on the happy path, **bare `return next(error)`** in the catch block
- **CRITICAL:** Do NOT call `logger.error()` in controller catch blocks — `apiErrorHandler` middleware logs all errors centrally. Adding `logger.error()` before `next(error)` creates redundant logging and is a reviewer-flagged anti-pattern.
- **Exception:** Controllers that handle their own response in the catch block (e.g., SSE streaming with `res.end()`) must log errors themselves since `apiErrorHandler` is never reached.
- Pass errors to `next(error)` — NEVER use `res.status(500).json()`
- Operation names in snake_case (e.g., `get_items`, `create_item`)
- Use `validateUidParameter` from helpers for parameter validation

### Controller Example Pattern

```typescript
import { NextFunction, Request, Response } from 'express';

import { validateUidParameter } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { myService } from '../services/my.service';

export const getItems = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'get_items', {});

  try {
    const items = await myService.getItems(req, req.query);
    logger.success(req, 'get_items', startTime, { count: items.data.length });
    return res.json(items);
  } catch (error) {
    // Do NOT call logger.error() here — apiErrorHandler logs centrally
    return next(error);
  }
};

export const getItemById = async (req: Request, res: Response, next: NextFunction) => {
  const { uid } = req.params;
  const startTime = logger.startOperation(req, 'get_item', { uid });

  if (!validateUidParameter(uid, req, next, { operation: 'get_item', logStartTime: startTime })) {
    return;
  }

  try {
    const item = await myService.getItemById(req, uid);
    logger.success(req, 'get_item', startTime, { uid });
    return res.json(item);
  } catch (error) {
    // Do NOT call logger.error() here — apiErrorHandler logs centrally
    return next(error);
  }
};
```

---

## Route (`src/server/routes/<name>.route.ts`)

- Express Router with controller method bindings
- Follow the pattern from an existing route file

### Route Example Pattern

```typescript
import { Router } from 'express';
import { getItems, getItemById, createItem } from '../controllers/my.controller';

const router = Router();

router.get('/', getItems);
router.get('/:uid', getItemById);
router.post('/', createItem);

export default router;
```

---

## Route Registration

**IMPORTANT:** The route must be registered in `server.ts`, which is a protected file.
Tell the contributor:

> "The route file is created, but it needs to be registered in `server.ts`. Since that's a protected infrastructure file, please ask a code owner to add the route registration."

## Error Handling

- Use `MicroserviceError.fromMicroserviceResponse()` for upstream failures
- Use `ServiceValidationError.forField()` for input validation
- Use type guards (`isBaseApiError`, `isMicroserviceError`) for safe error detection
- NEVER `res.status(500).json()` — always `next(error)`

## Pagination

- Single-page: Return `PaginatedResponse<T>` with `page_token`
- All-pages: Use `fetchAllQueryResources` helper with callback
- Use `page_size` (not `limit`), conditional `page_token` spread

## Checklist

- [ ] Service uses `MicroserviceProxyService` (not raw `fetch`/`axios`)
- [ ] Service uses `logger` service (not `serverLogger`)
- [ ] Controller uses `logger.startOperation()` / `logger.success()` (no `logger.error()` in catch blocks — `apiErrorHandler` logs centrally)
- [ ] Controller uses bare `return next(error)` in catch blocks (not `res.status(500)`, not `logger.error()` before `next(error)`)
- [ ] Controller uses validation helpers for parameter validation
- [ ] Route file follows existing patterns
- [ ] Contributor is informed about `server.ts` registration
- [ ] All files have license headers

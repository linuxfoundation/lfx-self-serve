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
import { QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

class MyService {
  private microserviceProxy: MicroserviceProxyService;

  constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  public async getItems(req: Request): Promise<Item[]> {
    logger.debug(req, 'get_items', 'Fetching items from upstream', {});

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Item>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      resource_type: 'my_items',
    });

    logger.debug(req, 'get_items', 'Fetched items', { count: resources.length });
    return resources.map((r: any) => r.data);
  }
}
```

---

## Controller (`src/server/controllers/<name>.controller.ts`)

- `logger.startOperation()` → `try/catch` → `logger.success()` or `next(error)`
- Pass errors to `next(error)` — NEVER use `res.status(500).json()`
- Operation names in snake_case (e.g., `get_items`, `create_item`)
- Use `validateUidParameter` from helpers for parameter validation

### Controller Example Pattern

```typescript
import { logger } from '../services/logger.service';
import { myService } from '../services/my.service';

export const getItems = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'get_items', {});

  try {
    const items = await myService.getItems(req);
    logger.success(req, 'get_items', startTime, { count: items.length });
    return res.json(items);
  } catch (error) {
    logger.error(req, 'get_items', startTime, error, {});
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
import { getItems, createItem } from '../controllers/my.controller';

const router = Router();

router.get('/items', getItems);
router.post('/items', createItem);

export default router;
```

---

## Route Registration

**IMPORTANT:** The route must be registered in `server.ts`, which is a protected file.
Tell the contributor:

> "The route file is created, but it needs to be registered in `server.ts`. Since that's a protected infrastructure file, please ask a code owner to add the route registration."

## Checklist

- [ ] Service uses `MicroserviceProxyService` (not raw `fetch`/`axios`)
- [ ] Service uses `logger` service (not `serverLogger`)
- [ ] Controller uses `logger.startOperation()` / `logger.success()` / `logger.error()`
- [ ] Controller passes errors to `next(error)` (not `res.status(500)`)
- [ ] Route file follows existing patterns
- [ ] Contributor is informed about `server.ts` registration
- [ ] All files have license headers

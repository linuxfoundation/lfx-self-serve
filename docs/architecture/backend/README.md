<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Backend Architecture

## Overview

The LFX One backend follows a **Controller-Service pattern** with an Express.js server handling SSR, authentication, and API routing. The architecture emphasizes separation of concerns, structured logging, and integration with microservices.

### Server Stack

- **Express.js** server with Angular 20 built-in SSR
- **Auth0** authentication with express-openid-connect
- **Pino** structured JSON logging with sensitive data redaction
- **PM2** process management for production deployment

### Core Architecture

```text
Request → Controller → Service → Microservice/Data Layer
           ↓            ↓
        Validation    Business Logic
        Logging       Data Transformation
        next(error)   Error Handling
```

- **Controllers** handle HTTP boundary: validation, logging lifecycle, response
- **Services** handle business logic: API calls via `MicroserviceProxyService`, data transformation
- **Helpers** provide reusable utilities: validation type guards, pagination, polling
- **Logger Service** is the singleton interface for all application logging

## Documentation

| Document                                            | Topics                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| [SSR Server](./ssr-server.md)                       | Express.js configuration, Angular SSR integration, static assets, health checks |
| [Authentication](./authentication.md)               | Auth0 integration, selective auth middleware, M2M tokens, session management    |
| [Logging & Monitoring](./logging-monitoring.md)     | Pino logger service, operation lifecycle, log levels, CloudWatch format         |
| [Error Handling](./error-handling-architecture.md)  | Error classification, ServiceValidationError, error middleware                  |
| [Server Helpers](./server-helpers.md)               | Validation type guards, pagination helper, polling, URL validation              |
| [Pagination](./pagination.md)                       | Cursor-based pagination, fetchAllQueryResources, frontend patterns              |
| [AI Service](./ai-service.md)                       | LiteLLM proxy, meeting agenda generation, JSON schema validation                |
| [NATS Integration](./nats-integration.md)           | Inter-service messaging, project slug resolution, lazy connections              |
| [Snowflake Integration](./snowflake-integration.md) | Analytics queries, connection pooling, query deduplication                      |
| [Public Meetings](./public-meetings.md)             | Unauthenticated meeting access, M2M token flow                                  |

## Directory Structure

```text
apps/lfx-one/src/server/
├── controllers/              # HTTP request handling (15 controllers)
├── services/                 # Business logic layer (20 services)
├── routes/                   # Express route definitions (15 route files)
├── helpers/                  # Pure utility functions (7 helpers)
├── middleware/               # Express middleware
│   ├── auth.middleware.ts    # Unified auth with selective route config
│   └── error-handler.middleware.ts
├── utils/                    # Shared server utilities
├── server.ts                 # Server bootstrap and route registration
└── server-logger.ts          # Base Pino logger instance
```

## Key Patterns

### Controller Pattern

```typescript
export const getItems = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'get_items', { query: req.query });

  try {
    const result = await itemService.getItems(req, req.query);
    logger.success(req, 'get_items', startTime, { count: result.data.length });
    res.json(result);
  } catch (error) {
    logger.error(req, 'get_items', startTime, error);
    next(error); // Never res.status(500).json() — use next(error)
  }
};
```

### Service Pattern

```typescript
export class ItemService {
  public async getItems(req: Request, query: Record<string, any>): Promise<{ data: Item[]; page_token?: string }> {
    logger.debug(req, 'get_items', 'Fetching items', { query_params: Object.keys(query) });

    const { resources, page_token } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Item>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      ...query,
      type: 'item',
    });

    return { data: resources.map((r) => r.data), page_token };
  }
}
```

### Logging Rules

- **Controllers**: `logger.startOperation()` → `logger.success()` / `logger.error()` with `startTime`
- **Services**: `logger.debug()` for tracing, `logger.info()` for significant operations, `logger.warning()` for graceful errors
- **Never** import `serverLogger` directly — always use `logger` from `logger.service.ts`

See [Logging & Monitoring](./logging-monitoring.md) for full details.

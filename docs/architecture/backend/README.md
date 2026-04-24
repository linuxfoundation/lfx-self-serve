<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Backend Architecture

## Overview

The LFX One backend follows a modern **Controller-Service pattern** with an Express.js server handling SSR, authentication, and API routing. The architecture emphasizes separation of concerns, structured logging, maintainability, and integration with microservices.

## Architecture Components

### Server Stack

- **Express.js** server with Angular 20 built-in SSR
- **Auth0** authentication integration with express-openid-connect
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

### Core Services

- **Logger Service**: Singleton service (`logger.service.ts`) providing unified logging interface for all application logging
- **ETag Service**: Concurrency control for safe data operations
- **Error Classes**: Custom error hierarchy (BaseApiError, AuthenticationError, AuthorizationError, MicroserviceError, ServiceValidationError)

### Architecture Roles

- **Controllers** handle HTTP boundary: validation, logging lifecycle, response
- **Services** handle business logic: API calls via `MicroserviceProxyService`, data transformation
- **Helpers** provide reusable utilities: validation type guards, pagination, polling

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

### Committee Management

- **CommitteeController**: HTTP request handling and validation
- **CommitteeService**: Business logic and microservice integration
- **CRUD Operations**: Create, Read, Update, Delete with ETag concurrency control

### Meeting Management

- **MeetingController**: Meeting CRUD, scheduling, and calendar integration
- **PastMeetingController**: Past meeting recordings and attendance
- **PublicMeetingController**: Public meeting join page (unauthenticated)

### Survey & Vote Management

- **SurveyController/Service**: Survey CRUD, response collection, NPS analytics
- **VoteController/Service**: Poll creation, vote casting, results tabulation

### User & Organization

- **UserController/Service**: User management and preferences
- **ProfileController/Service**: User profile management
- **OrganizationController/Service**: Organization data and membership

### Search & Analytics

- **SearchController/Service**: Cross-entity search functionality
- **AnalyticsController**: Snowflake-powered analytics queries

### Mailing List Management

- **MailingListController/Service**: Mailing list CRUD, subscription management

### AI Integration Service

- **AI Service**: Claude Sonnet integration for meeting agenda generation
- **LiteLLM Proxy**: OpenAI-compatible API proxy for AI model access
- **JSON Schema Validation**: Strict response validation with fallback parsing

### NATS Messaging Service

- **NATS Service**: High-performance inter-service messaging (generic infrastructure)
- **Project Service**: Business logic consuming NATS for project slug resolution, user lookup
- **Lazy Connection Management**: On-demand connection with automatic reconnection
- **Kubernetes Service Discovery**: Native cluster DNS integration for NATS access

### Authentication & Session Management

- **Auth Middleware**: Unified authentication middleware with route classification (public/optional/required)
- **M2M Token Utility**: Machine-to-machine token management for server-side API calls
- **User Context**: Request-scoped AuthContext with user, persona, and organizations

## Key Features

### Architecture & Design Patterns

- **Controller-Service Pattern**: Clean separation between HTTP handling and business logic
- **Logger Service**: Singleton service with request-scoped and infrastructure logging modes
- **Microservice Integration**: Seamless integration with LFX Query Service and other microservices
- **ETag Concurrency Control**: Safe concurrent operations with optimistic locking
- **Custom Error Hierarchy**: Typed error classes for authentication, authorization, validation, and microservice errors

### Core Platform Services

- **Server-Side Rendering**: Angular 20 built-in SSR with Express.js for optimal SEO and performance
- **Authentication**: Auth0 integration with selective route protection (public/optional/required)
- **Structured Logging**: Pino with request correlation, timing, and sensitive data redaction
- **Process Management**: PM2 for production deployment with health monitoring
- **Health Monitoring**: Built-in health check endpoints with detailed system status
- **AI Integration**: Claude Sonnet model integration via LiteLLM proxy for intelligent features

### Development & Quality

- **TypeScript**: Full type safety with shared interfaces across frontend and backend
- **Validation**: Comprehensive input validation with detailed error responses
- **Error Handling**: Custom error class hierarchy with centralized error handler middleware
- **Testing**: E2E testing with Playwright

## Directory Structure

```text
apps/lfx-one/src/server/
├── constants/                # Server-only constants (rewards, etc.)
├── controllers/              # HTTP request handling layer
├── errors/                   # Custom error class hierarchy
├── helpers/                  # Pure utility functions (error serialization, HTTP status, ICS, meeting, poll-endpoint, query-service, URL + input validation)
├── middleware/               # Express middleware (auth, error-handler, rate-limit)
├── pdf-templates/            # PDF generation templates (e.g., visa letters)
├── routes/                   # Express route definitions
├── services/                 # Business logic layer
├── utils/                    # Shared server utilities (auth, lock manager, M2M token, persona, security)
├── server.ts                 # Server bootstrap and route registration
├── server-logger.ts          # Base Pino logger instance
└── server-tracer.ts          # OpenTelemetry tracer and SERVICE_NAME
```

Per-file inventories rot quickly — run `ls apps/lfx-one/src/server/<dir>/` for the canonical listing. The category descriptions above stay stable even as specific files come and go.

### Controllers & Services

Each HTTP boundary typically has a `{domain}.controller.ts` + `{domain}.route.ts` pair (e.g. `meeting.controller.ts` ↔ `meetings.route.ts`) and a backing `{domain}.service.ts`. This three-file pattern is the standard backend convention used throughout the codebase. Domains currently include analytics, badges, committees, copilot, documents, events, impersonation, mailing-lists, meetings (+ past-meetings, public-meetings), navigation, organizations, persona, profile, projects, rewards, search, surveys, training, transactions, user, and votes.

Infrastructure services that don't map to a single HTTP boundary:

- **`logger.service.ts`** — singleton logging service (always prefer over the raw `serverLogger`).
- **`microservice-proxy.service.ts`** — HTTP gateway for every upstream microservice call.
- **`nats.service.ts`** — generic NATS request/reply client (consumed by `project.service.ts` and others for slug resolution, user lookup, etc.).
- **`snowflake.service.ts`** — singleton Snowflake connection pool with query deduplication.
- **`etag.service.ts`** — ETag-based optimistic concurrency control for CRUD resources.
- **`persona-detection.service.ts` / `persona-enrichment.service.ts`** — persona classification used by the lens system.
- **`auth0.service.ts`, `supabase.service.ts`, `cdp.service.ts`, `credly.service.ts`, `ti.service.ts`** — third-party integrations (authentication, profile email, analytics, badging).

### Errors

Custom error hierarchy under `errors/`: `BaseApiError` is the root; `AuthenticationError` (401) and `AuthorizationError` (403) live in `authentication.error.ts`; `MicroserviceError` wraps upstream failures; `ServiceValidationError` represents input-validation problems. All errors are exported via `index.ts` and handled centrally by the error-handler middleware.

### Routes

All feature routes are mounted under `/api/<domain>` from `server.ts` — e.g. `/api/meetings`, `/api/committees`, `/api/votes`. Public, unauthenticated surfaces are under `/public/api/*` (currently public meetings and public committees). Health and telemetry endpoints are wired directly in `server.ts`.

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

## Best Practices

- **TypeScript**: Strict type checking enabled
- **Interfaces**: All interfaces in shared package (`@lfx-one/shared/interfaces`)
- **Validation**: Comprehensive input validation with detailed error responses
- **Linting**: ESLint with Prettier formatting
- **License Headers**: Required on all source files

## Quick Links

- [Server Configuration](../../CLAUDE.md#backend-stack)
- [Logging System](../../CLAUDE.md#logging-system)
- [Shared Interfaces](../shared/package-architecture.md)
- [Frontend Integration](../frontend/README.md)

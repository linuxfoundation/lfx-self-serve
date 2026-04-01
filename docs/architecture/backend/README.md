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
├── controllers/              # HTTP request handling layer (15 controllers)
│   ├── analytics.controller.ts
│   ├── committee.controller.ts
│   ├── mailing-list.controller.ts
│   ├── meeting.controller.ts
│   ├── organization.controller.ts
│   ├── past-meeting.controller.ts
│   ├── profile.controller.ts
│   ├── project.controller.ts
│   ├── public-meeting.controller.ts
│   ├── search.controller.ts
│   ├── survey.controller.ts
│   ├── user.controller.ts
│   └── vote.controller.ts
├── errors/                   # Custom error class hierarchy
│   ├── base.error.ts         # BaseApiError with status code and error code
│   ├── authentication.error.ts # AuthenticationError (401) and AuthorizationError (403)
│   ├── microservice.error.ts # MicroserviceError for upstream failures
│   ├── service-validation.error.ts # ServiceValidationError for input validation
│   └── index.ts              # Barrel export
├── helpers/                  # Pure utility functions (7 helpers)
│   ├── error-serializer.ts   # Pino error serializer for structured logging
│   ├── http-status.helper.ts # HTTP status code constants
│   ├── meeting.helper.ts     # Meeting-specific helpers
│   ├── url-validation.ts     # URL input validation
│   └── validation.helper.ts  # General validation helpers
├── middleware/               # Express middleware
│   ├── auth.middleware.ts    # Unified auth with selective route config
│   └── error-handler.middleware.ts # Centralized error handler
├── routes/                   # Express route definitions (15 route files)
│   ├── analytics.route.ts
│   ├── committees.route.ts
│   ├── mailing-lists.route.ts
│   ├── meetings.route.ts
│   ├── organizations.route.ts
│   ├── past-meetings.route.ts
│   ├── profile.route.ts
│   ├── projects.route.ts
│   ├── public-meetings.route.ts
│   ├── search.route.ts
│   ├── surveys.route.ts
│   ├── user.route.ts
│   └── votes.route.ts
├── services/                 # Business logic layer (20 services)
│   ├── access-check.service.ts    # Permission/access validation
│   ├── ai.service.ts              # Claude Sonnet AI integration
│   ├── api-client.service.ts      # HTTP client for external APIs
│   ├── committee.service.ts       # Committee business logic
│   ├── etag.service.ts            # ETag concurrency control
│   ├── logger.service.ts          # Singleton logging service
│   ├── mailing-list.service.ts    # Mailing list business logic
│   ├── meeting.service.ts         # Meeting business logic
│   ├── microservice-proxy.service.ts # Microservice proxy/gateway
│   ├── nats.service.ts            # NATS messaging (infrastructure)
│   ├── organization.service.ts    # Organization data
│   ├── project.service.ts         # Project lookup (uses NATS + Snowflake)
│   ├── search.service.ts          # Search aggregation
│   ├── snowflake.service.ts       # Snowflake analytics (singleton)
│   ├── supabase.service.ts        # Supabase integration
│   ├── survey.service.ts          # Survey business logic
│   ├── user.service.ts            # User management
│   └── vote.service.ts            # Vote/poll business logic
├── utils/                    # Shared server utilities
│   ├── auth-helper.ts        # Auth utility functions
│   ├── lock-manager.ts       # Distributed lock management
│   ├── m2m-token.util.ts     # Machine-to-machine token management
│   ├── organization-matcher.ts # Organization matching logic
│   ├── persona-helper.ts     # User persona helpers
│   └── security.util.ts      # Security utilities
├── server.ts                 # Server bootstrap and route registration
├── server-logger.ts          # Base Pino logger instance
└── server-tracer.ts          # OpenTelemetry tracer and SERVICE_NAME
```

### API Routes

| Route                  | Controller              | Description                            |
| ---------------------- | ----------------------- | -------------------------------------- |
| `/api/analytics`       | AnalyticsController     | Snowflake-powered analytics queries    |
| `/api/committees`      | CommitteeController     | Committee CRUD with ETag concurrency   |
| `/api/mailing-lists`   | MailingListController   | Mailing list management                |
| `/api/meetings`        | MeetingController       | Meeting scheduling and management      |
| `/api/organizations`   | OrganizationController  | Organization data and membership       |
| `/api/past-meetings`   | PastMeetingController   | Past meeting recordings and attendance |
| `/api/profile`         | ProfileController       | User profile management                |
| `/api/projects`        | ProjectController       | Project data and lookup                |
| `/api/public/meetings` | PublicMeetingController | Public meeting join (unauthenticated)  |
| `/api/search`          | SearchController        | Cross-entity search                    |
| `/api/surveys`         | SurveyController        | Survey management and responses        |
| `/api/user`            | UserController          | User management and preferences        |
| `/api/votes`           | VoteController          | Poll creation and vote casting         |

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

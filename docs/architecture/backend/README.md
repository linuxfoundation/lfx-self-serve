# Backend Architecture

## Overview

The LFX One backend follows a modern **Controller-Service pattern** with Express.js server handling SSR, authentication, and API services. The architecture emphasizes separation of concerns, maintainability, and integration with microservices.

## Architecture Components

### Server Stack

- **Express.js** server with Angular 19 built-in SSR
- **Auth0** authentication integration with express-openid-connect
- **Pino** structured JSON logging with sensitive data redaction
- **PM2** process management for production deployment
- **Controller-Service Pattern** for clean architecture separation

### Core Architecture Patterns

#### Controller-Service Pattern

```text
Request → Controller → Service → Microservice/Data Layer
           ↓           ↓
        Validation   Business Logic
        Logging      Data Transformation
        Response     Error Handling
```

#### Core Services

- **Logger Service**: Singleton service (`logger.service.ts`) providing unified logging interface for all application logging
- **ETag Service**: Concurrency control for safe data operations
- **Error Classes**: Custom error hierarchy (BaseError, AuthenticationError, AuthorizationError, MicroserviceError, ServiceValidationError)

### API Services

#### Committee Management

- **CommitteeController**: HTTP request handling and validation
- **CommitteeService**: Business logic and microservice integration
- **CRUD Operations**: Create, Read, Update, Delete with ETag concurrency control

#### Meeting Management

- **MeetingController**: Meeting CRUD, scheduling, and calendar integration
- **PastMeetingController**: Past meeting recordings and attendance
- **PublicMeetingController**: Public meeting join page (unauthenticated)

#### Survey & Vote Management

- **SurveyController/Service**: Survey CRUD, response collection, NPS analytics
- **VoteController/Service**: Poll creation, vote casting, results tabulation

#### User & Organization

- **UserController/Service**: User management and preferences
- **ProfileController/Service**: User profile management
- **OrganizationController/Service**: Organization data and membership

#### Search & Analytics

- **SearchController/Service**: Cross-entity search functionality
- **AnalyticsController**: Snowflake-powered analytics queries

#### Mailing List Management

- **MailingListController/Service**: Mailing list CRUD, subscription management

#### AI Integration Service

- **AI Service**: Claude Sonnet integration for meeting agenda generation
- **LiteLLM Proxy**: OpenAI-compatible API proxy for AI model access
- **JSON Schema Validation**: Strict response validation with fallback parsing

#### NATS Messaging Service

- **NATS Service**: High-performance inter-service messaging (generic infrastructure)
- **Project Service**: Business logic consuming NATS for project slug resolution, user lookup
- **Lazy Connection Management**: On-demand connection with automatic reconnection
- **Kubernetes Service Discovery**: Native cluster DNS integration for NATS access

#### Authentication & Session Management

- **Auth Middleware**: Unified authentication middleware with route classification (public/optional/required)
- **M2M Token Utility**: Machine-to-machine token management for server-side API calls
- **User Context**: Request-scoped AuthContext with user, persona, and organizations

## Documentation Sections

### [SSR Server](./ssr-server.md)

Learn about Express.js configuration, Angular SSR integration, and server-side rendering setup.

### [Authentication](./authentication.md)

Understand Auth0 integration, unified auth middleware, and user session management.

### [Logging & Monitoring](./logging-monitoring.md)

Explore Pino logging configuration, structured logging, and the LoggerService pattern.

### [AI Service](./ai-service.md)

Learn about AI integration, Claude Sonnet model configuration, and meeting agenda generation.

### [NATS Integration](./nats-integration.md)

Understand NATS messaging integration, project slug resolution, and inter-service communication.

### [Snowflake Integration](./snowflake-integration.md)

Learn about Snowflake analytics queries and the SnowflakeService singleton.

### [Error Handling Architecture](./error-handling-architecture.md)

Understand the custom error class hierarchy and centralized error handling.

### [Public Meetings](./public-meetings.md)

Learn about public meeting join pages, V1/V2 detection, and unauthenticated access.

### [Deployment](../../deployment.md)

Discover PM2 configuration, production deployment, and server management.

## Key Features

### Architecture & Design Patterns

- **Controller-Service Pattern**: Clean separation between HTTP handling and business logic
- **Logger Service**: Singleton service with request-scoped and infrastructure logging modes
- **Microservice Integration**: Seamless integration with LFX Query Service and other microservices
- **ETag Concurrency Control**: Safe concurrent operations with optimistic locking
- **Custom Error Hierarchy**: Typed error classes for authentication, authorization, validation, and microservice errors

### Core Services

- **Server-Side Rendering**: Angular 19 built-in SSR with Express.js for optimal SEO and performance
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

## Implementation Details

### Logger Service (`/server/services/logger.service.ts`)

The logger service is a singleton that provides a unified logging interface. See [CLAUDE.md Logging System](../../CLAUDE.md#logging-system) for complete documentation.

```typescript
import { logger } from './logger.service';

// Controller usage (with request context):
const startTime = logger.startOperation(req, 'get_committees', { query });
logger.success(req, 'get_committees', startTime, { count: result.length });
logger.error(req, 'get_committees', startTime, error, { query });

// Service usage (debug tracing):
logger.debug(req, 'get_committees', 'Fetching from microservice', { query });
logger.warning(req, 'get_committees', 'No results found', { query });

// Infrastructure usage (no request context):
const startTime = logger.startOperation(undefined, 'nats_connect', { url });
logger.success(undefined, 'nats_connect', startTime);
```

### Controller-Service Pattern Implementation

#### Example: Committee Management

**Controller Layer** (`/server/controllers/committee.controller.ts`):

```typescript
export const getCommittees = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'get_committees', {
    query_params: req.query,
  });

  try {
    const committees = await committeeService.getCommittees(req, req.query);

    logger.success(req, 'get_committees', startTime, {
      committee_count: committees.length,
    });

    res.json(committees);
  } catch (error) {
    logger.error(req, 'get_committees', startTime, error);
    next(error);
  }
};
```

**Service Layer** (`/server/services/committee.service.ts`):

```typescript
export class CommitteeService {
  public async getCommittees(req: Request, queryParams: any): Promise<Committee[]> {
    logger.debug(req, 'get_committees', 'Fetching committees from microservice', { queryParams });

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      ...queryParams,
      type: 'committee',
    });

    return resources.map((resource) => resource.data);
  }
}
```

## Directory Structure

```text
apps/lfx-one/src/server/
├── controllers/              # HTTP request handling layer (13 controllers)
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
│   ├── base.error.ts         # BaseError with status code and error code
│   ├── authentication.error.ts # AuthenticationError (401) and AuthorizationError (403)
│   ├── microservice.error.ts # MicroserviceError for upstream failures
│   ├── service-validation.error.ts # ServiceValidationError for input validation
│   └── index.ts              # Barrel export
├── helpers/                  # Server helper utilities
│   ├── error-serializer.ts   # Pino error serializer for structured logging
│   ├── http-status.helper.ts # HTTP status code constants
│   ├── meeting.helper.ts     # Meeting-specific helpers
│   ├── url-validation.ts     # URL input validation
│   └── validation.helper.ts  # General validation helpers
├── middleware/               # Express middleware
│   ├── auth.middleware.ts    # Unified auth middleware (public/optional/required route classification)
│   └── error-handler.middleware.ts # Centralized error handler
├── routes/                   # API route definitions (13 route files)
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
├── services/                 # Business logic layer (18 services)
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
├── utils/                    # Server utilities
│   ├── auth-helper.ts        # Auth utility functions
│   ├── lock-manager.ts       # Distributed lock management
│   ├── m2m-token.util.ts     # Machine-to-machine token management
│   ├── organization-matcher.ts # Organization matching logic
│   ├── persona-helper.ts     # User persona helpers
│   └── security.util.ts      # Security utilities
├── server.ts                 # Express server entry point
└── server-logger.ts          # Base Pino logger configuration
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

## Best Practices

### Development Guidelines

1. **Controller Responsibilities**:
   - HTTP request/response handling
   - Input validation and sanitization
   - `logger.startOperation()` / `logger.success()` / `logger.error()` for HTTP operations
   - Pass errors to `next(error)` for centralized handling

2. **Service Responsibilities**:
   - Business logic implementation
   - Microservice integration
   - `logger.debug()` for step-by-step tracing
   - `logger.info()` for significant business operations
   - `logger.warning()` for graceful error handling (returning null/empty)

3. **Logging Rules**:
   - Always use `logger` service, never `serverLogger` directly
   - Controllers: one `startOperation` per endpoint
   - Services: `debug` for tracing, `info` for significant operations
   - Always pass `req` when available, `undefined` for infrastructure

4. **Error Handling**:
   - Use custom error classes from `errors/` directory
   - Centralized error handler middleware converts errors to HTTP responses
   - Always log errors with context using `logger.error()`
   - Use `logger.warning()` for recoverable errors

### Code Quality Standards

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

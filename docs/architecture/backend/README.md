# Backend Architecture

## 🖥 Overview

The LFX PCC backend follows a modern **Controller-Service pattern** with Express.js server handling SSR, authentication, and API services. The architecture emphasizes separation of concerns, maintainability, and integration with microservices.

## 🏗 Architecture Components

### Server Stack

- **Express.js** server with Angular Universal SSR
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

#### Helper Classes

- **Logger Helper**: Standardized request logging with timing and context
- **Responder Helper**: Consistent error response formatting
- **ETag Service**: Concurrency control for safe data operations

### API Services

#### Committee Management Service

- **CommitteeController**: HTTP request handling and validation
- **CommitteeService**: Business logic and microservice integration
- **CRUD Operations**: Create, Read, Update, Delete with ETag concurrency control
- **Query Service Integration**: Integration with LFX Query Service microservice

#### AI Integration Service

- **AI Service**: Claude Sonnet integration for meeting agenda generation
- **LiteLLM Proxy**: OpenAI-compatible API proxy for AI model access
- **JSON Schema Validation**: Strict response validation with fallback parsing
- **Meeting API Integration**: Protected endpoints for AI-powered features

#### NATS Messaging Service

- **NATS Service**: High-performance inter-service messaging integration
- **Project Slug Resolution**: Real-time project lookup via request-reply pattern
- **Lazy Connection Management**: On-demand connection with automatic reconnection
- **Kubernetes Service Discovery**: Native cluster DNS integration for NATS access

#### Authentication & Session Management

- **Auth0 Integration**: OpenID Connect with session-based authentication
- **Token Management**: Automatic token refresh and validation
- **User Context**: Request-scoped user information and permissions

## 📋 Documentation Sections

### [SSR Server](./ssr-server.md)

Learn about Express.js configuration, Angular Universal integration, and server-side rendering setup.

### [Authentication](./authentication.md)

Understand Auth0 integration, JWT handling, and user session management.

### [Logging & Monitoring](./logging-monitoring.md)

Explore Winston logging configuration, structured logging, and monitoring strategies.

### [AI Service](./ai-service.md)

Learn about AI integration, Claude Sonnet model configuration, and meeting agenda generation.

### [NATS Integration](./nats-integration.md)

Understand NATS messaging integration, project slug resolution, and inter-service communication.

### [Deployment](../../deployment.md)

Discover PM2 configuration, production deployment, and server management.

## 🚀 Key Features

### Architecture & Design Patterns

- **Controller-Service Pattern**: Clean separation between HTTP handling and business logic
- **Helper Classes**: Reusable utilities for logging, response formatting, and data validation
- **Microservice Integration**: Seamless integration with LFX Query Service and other microservices
- **ETag Concurrency Control**: Safe concurrent operations with optimistic locking

### Core Services

- **Server-Side Rendering**: Angular Universal with Express.js for optimal SEO and performance
- **Authentication**: Auth0 integration with OpenID Connect and session management
- **Structured Logging**: Pino with request correlation, timing, and sensitive data redaction
- **Process Management**: PM2 for production deployment with health monitoring
- **Health Monitoring**: Built-in health check endpoints with detailed system status
- **AI Integration**: Claude Sonnet model integration via LiteLLM proxy for intelligent features

### Development & Quality

- **TypeScript**: Full type safety with shared interfaces across frontend and backend
- **Validation**: Comprehensive input validation with detailed error responses
- **Error Handling**: Consistent error formatting and microservice compatibility
- **Testing**: E2E testing with Playwright and comprehensive test coverage

## 🔧 Implementation Details

### Helper Classes Architecture

#### Logger Helper (`/server/helpers/logger.ts`)

```typescript
export class Logger {
  static start(req: Request, operation: string, metadata?: Record<string, any>): number;
  static success(req: Request, operation: string, startTime: number, metadata?: Record<string, any>): void;
  static error(req: Request, operation: string, startTime: number, error: any, metadata?: Record<string, any>): void;
  static validation(req: Request, operation: string, validationErrors: any[], metadata?: Record<string, any>): void;
  static etag(req: Request, operation: string, resourceType: string, resourceId: string, etag?: string, metadata?: Record<string, any>): void;
  static warning(req: Request, operation: string, message: string, metadata?: Record<string, any>): void;
  static sanitize(metadata: Record<string, any>): Record<string, any>;
}
```

**Features:**

- Request correlation with unique IDs
- Operation timing and performance metrics
- Sensitive data sanitization (passwords, tokens, secrets)
- Structured JSON logging with context

#### Responder Helper (`/server/helpers/responder.ts`)

```typescript
export class Responder {
  static error(res: Response, message: string, options?: ErrorOptions): void;
  static badRequest(res: Response, message?: string, details?: Record<string, any>): void;
  static unauthorized(res: Response, message?: string): void;
  static forbidden(res: Response, message?: string): void;
  static notFound(res: Response, message?: string): void;
  static conflict(res: Response, message?: string): void;
  static preconditionFailed(res: Response, message?: string): void;
  static validationError(res: Response, errors: ValidationError[], message?: string): void;
  static internalError(res: Response, message?: string): void;
  static handle(res: Response, error: any, operation?: string): void;
  static createPagination(page: number, limit: number, total: number): PaginationInfo;
}
```

**Features:**

- Consistent error response format across all endpoints
- HTTP status code standardization
- Validation error aggregation
- ETag conflict handling
- Microservice response compatibility

#### ETag Service (`/server/services/etag.service.ts`)

```typescript
export class ETagService {
  constructor(private microserviceProxy: MicroserviceProxyService);
  async fetchWithETag<T>(req: Request, service: string, path: string, operation: string): Promise<ETagResult<T>>;
  async updateWithETag<T>(req: Request, service: string, path: string, etag: string, data: any, operation: string): Promise<T>;
  async deleteWithETag(req: Request, service: string, path: string, etag: string, operation: string): Promise<void>;
}
```

**Features:**

- Optimistic concurrency control using HTTP If-Match headers
- ETag extraction and validation from response headers
- Conflict detection and resolution (412 Precondition Failed)
- Integration with microservice ETag headers following HTTP standards

### Controller-Service Pattern Implementation

#### Example: Committee Management

**Controller Layer** (`/server/controllers/committee.controller.ts`):

```typescript
export class CommitteeController {
  public async getCommittees(req: Request, res: Response): Promise<void> {
    const startTime = Logger.start(req, 'get_committees', {
      query_params: Logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const committees = await this.committeeService.getCommittees(req, req.query);

      Logger.success(req, 'get_committees', startTime, {
        committee_count: committees.length,
      });

      res.json(committees);
    } catch (error) {
      Logger.error(req, 'get_committees', startTime, error);
      Responder.handle(res, error, 'get_committees');
    }
  }
}
```

**Service Layer** (`/server/services/committee.service.ts`):

```typescript
export class CommitteeService {
  public async getCommittees(req: Request, queryParams: any): Promise<Committee[]> {
    // Business logic and microservice integration
    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      ...queryParams,
      type: 'committee',
    });

    return resources.map((resource) => resource.data);
  }
}
```

**Benefits:**

- **Separation of Concerns**: Controllers handle HTTP, Services handle business logic
- **Testability**: Each layer can be unit tested independently
- **Maintainability**: Clear boundaries and responsibilities
- **Reusability**: Services can be reused across different controllers
- **Consistency**: Standardized logging, error handling, and response formatting

## 📁 Directory Structure

```text
apps/lfx-pcc/src/server/
├── controllers/           # HTTP request handling layer
│   └── committee.controller.ts
├── services/             # Business logic layer
│   ├── committee.service.ts
│   ├── etag.service.ts
│   ├── api-client.service.ts
│   ├── microservice-proxy.service.ts
│   ├── ai.service.ts
│   ├── nats.service.ts
│   ├── project.service.ts
│   └── supabase.service.ts
├── helpers/              # Utility classes
│   ├── logger.ts         # Standardized logging
│   ├── responder.ts      # Response formatting
│   └── url-validation.ts # Input validation
├── middleware/           # Express middleware
│   ├── auth-token.middleware.ts
│   ├── error-handler.middleware.ts
│   └── token-refresh.middleware.ts
├── routes/               # Route definitions
│   ├── committees.ts
│   ├── meetings.ts
│   ├── permissions.ts
│   └── projects.ts
└── utils/                # Shared utilities
    └── api-error.ts
```

## 🎯 Best Practices

### Development Guidelines

1. **Controller Responsibilities**:
   - HTTP request/response handling
   - Input validation and sanitization
   - Request logging and timing
   - Error response formatting

2. **Service Responsibilities**:
   - Business logic implementation
   - Microservice integration
   - Data transformation and validation
   - Complex error handling

3. **Helper Usage**:
   - Use Logger for all operations with timing
   - Use Responder for consistent error responses
   - Sanitize sensitive data before logging
   - Handle ETags for concurrency control

4. **Error Handling**:
   - Always log errors with context
   - Use appropriate HTTP status codes
   - Provide meaningful error messages
   - Maintain microservice compatibility

### Code Quality Standards

- **TypeScript**: Strict type checking enabled
- **Interfaces**: All interfaces in shared package
- **Validation**: Comprehensive input validation
- **Testing**: Unit tests for services, E2E for controllers
- **Documentation**: JSDoc comments for public methods
- **Linting**: ESLint with Prettier formatting

## 🔗 Quick Links

- [Server Configuration](../../CLAUDE.md#backend-stack)
- [Development Commands](../../CLAUDE.md#development)
- [Production Deployment](../../CLAUDE.md#production)
- [Shared Interfaces](../shared/package-architecture.md)
- [Frontend Integration](../frontend/README.md)

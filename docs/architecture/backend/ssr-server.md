# SSR Server Architecture

## 🖥 Express.js with Angular 19 SSR

The LFX application employs a hybrid architecture combining Express.js as the backend server with Angular 19's built-in server-side rendering capabilities. This design provides both traditional server functionality for API endpoints and modern client-side experience through SSR.

### Architectural Overview

The server architecture follows a **layered approach** where Express.js handles the HTTP layer while Angular Universal manages the application rendering. This separation allows for:

- **Clear separation of concerns** between server logic and client rendering
- **Optimal performance** through static asset serving and SSR optimization
- **Flexible authentication** that works for both API calls and page rendering
- **Production-ready monitoring** with structured logging and health checks

### Server Initialization Strategy

The server employs a **dual-mode startup strategy** that automatically detects its execution environment:

- **Development Mode**: Integrates with Angular CLI dev server for hot module replacement
- **Production Mode**: Runs as standalone Node.js application with PM2 process management
- **Build Integration**: Provides request handler for Angular CLI build processes

This approach eliminates the need for separate server configurations across development and production environments.

## 🔧 Angular 19 SSR Integration

### Static Asset Strategy

The server implements an **aggressive caching strategy** for static assets, serving pre-built Angular browser bundles with long-term cache headers. This approach:

- **Maximizes browser caching** with 1-year expiration for immutable assets
- **Reduces server load** by serving static content directly from filesystem
- **Improves performance** through efficient asset delivery before application logic

### Health Monitoring Architecture

The application includes **dedicated health endpoints** designed for load balancers and monitoring systems. These endpoints:

- **Bypass authentication** to allow unrestricted health checks
- **Exclude from logging** to prevent log noise from monitoring systems
- **Provide immediate responses** without application dependency checks

### Structured Logging Strategy

The server implements **production-ready logging** using Pino for high-performance structured JSON logs. The logging architecture provides:

- **Automatic request/response logging** with performance metrics and status codes
- **Security-first redaction** automatically removes sensitive headers (authorization, cookies)
- **Smart filtering** excludes health check endpoints from logs to reduce noise
- **Configurable log levels** supporting development debugging and production monitoring

### Authentication Architecture

Authentication follows a **session-based approach** using Auth0 with express-openid-connect middleware. This design choice provides:

- **Seamless user experience** through secure session management with encrypted cookies
- **Automatic token refresh** to maintain user sessions without interruption
- **Flexible scope management** supporting both UI access and API authentication
- **Standards compliance** following OAuth 2.0 and OpenID Connect specifications

The authentication layer operates at the Express middleware level, ensuring all routes benefit from consistent security policies.

## 🚀 API Routes and Middleware Strategy

### Middleware Pipeline Architecture

The server employs a **carefully orchestrated middleware pipeline** that processes requests in specific order:

1. **Static Asset Serving** - Fast path for pre-built resources
2. **Health Monitoring** - Unobstructed monitoring endpoints
3. **Structured Logging** - Request/response tracking and metrics
4. **Authentication** - Session management and user context
5. **API Routes** - Business logic endpoints with bearer token validation
6. **Angular SSR** - Universal rendering for all remaining routes

### Authentication Architecture

The server implements selective authentication using Auth0/Authelia:

**Configuration Location**: `apps/lfx-one/src/server/server.ts`

Key features:

- **Selective Authentication**: `authRequired: false` allows custom middleware control
- **Custom Login Handler**: Disabled default login route for custom implementation
- **Protected Routes Middleware**: Replaces global auth requirement with selective protection

```typescript
// Authentication configuration
const authConfig: ConfigParams = {
  authRequired: false, // Selective authentication
  auth0Logout: true,
  routes: {
    login: false, // Custom login handler
  },
  // ... other configuration
};

app.use(auth(authConfig));
app.use(protectedRoutesMiddleware); // Selective route protection
```

### API Authentication Strategy

API endpoints use **dual authentication modes**:

- **Session-based** for browser requests from authenticated users
- **Bearer token** for programmatic API access and service-to-service communication

This hybrid approach supports both interactive user sessions and automated system integrations.

## 🔄 Server-Side Rendering Integration

### Authentication Context Injection

The SSR integration represents the **fallback handler** in the middleware chain, ensuring:

- **Universal application rendering** for all non-API routes
- **Authentication context injection** making user state available during SSR
- **Comprehensive error handling** with appropriate HTTP status codes
- **SEO optimization** through server-side content generation

Angular's `AngularNodeAppEngine` receives the complete request context, including user authentication state, enabling fully personalized server-side rendering.

### Error Handling Strategy

The server implements **graceful degradation** for rendering errors:

- **404 Not Found**: Proper HTTP status for missing routes
- **401 Unauthorized**: Authentication-required responses
- **500 Internal Server Error**: Comprehensive error logging with fallback responses

## 🚀 Production Deployment Architecture

### Process Management Strategy

The server supports **multiple deployment scenarios** through environment detection:

- **Development Mode**: Integrates with Angular CLI dev server for hot module replacement
- **Production Mode**: Runs as standalone Node.js application with PM2 process management
- **Build Integration**: Provides request handler for Angular CLI build processes

```typescript
// Environment detection enables seamless deployment
const isPM2 = process.env['PM2'] === 'true';
const isMain = isMainModule(import.meta.url);
```

This strategy eliminates the need for separate server configurations across environments.

### Key Architectural Decisions and Trade-offs

#### 1. Hybrid Authentication Model

**Decision**: Implement both session-based and bearer token authentication
**Trade-offs**:

- ✅ **Benefits**: Supports both browser users and API integrations seamlessly
- ⚠️ **Complexity**: Requires maintaining two authentication paths
- 🎯 **Rationale**: Enables flexible integration patterns while maintaining security

#### 2. Middleware Pipeline Ordering

**Decision**: Static assets → Health → Logging → Auth → API → SSR
**Trade-offs**:

- ✅ **Benefits**: Optimal performance with fast static asset serving
- ✅ **Benefits**: Unobstructed health monitoring for production systems
- ⚠️ **Complexity**: Pipeline order is critical for correct functionality

#### 3. Angular Universal Integration

**Decision**: Use Angular's built-in SSR engine rather than custom solution
**Trade-offs**:

- ✅ **Benefits**: Official Angular support with automatic optimizations
- ✅ **Benefits**: Seamless integration with Angular CLI development workflow
- ⚠️ **Vendor Lock-in**: Tightly coupled to Angular ecosystem

#### 4. Pino Logging Choice

**Decision**: Structured JSON logging over traditional text logs
**Trade-offs**:

- ✅ **Benefits**: High performance, structured queries, security redaction
- ⚠️ **Learning Curve**: Requires JSON log analysis tools for development debugging

## 📁 Modular Architecture

### Server Organization Strategy

The server follows a **domain-driven structure** that separates concerns:

- **server.ts** - Core application bootstrap and middleware orchestration
- **middleware/** - Reusable cross-cutting concerns (auth, logging, error handling)
- **routes/** - Domain-specific API endpoint handlers (projects, meetings)
- **services/** - Business logic and external integrations (AI, microservices)

This organization enables **independent testing** and **scalable development** as the application grows.

### Environment Configuration

The server uses **environment-aware configuration** supporting development, staging, and production deployment patterns with sensible defaults for local development.

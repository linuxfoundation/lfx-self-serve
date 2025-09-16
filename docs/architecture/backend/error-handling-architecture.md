# Error Handling Architecture

This document explains the architectural philosophy and design decisions behind LFX One's error handling system, focusing on the reasoning and trade-offs that shaped the current implementation.

## Philosophy and Core Principles

### Unified Error Response Format

The error handling architecture is built around the principle of **consistent client experience** regardless of error source. Whether errors originate from validation, microservice failures, or internal server issues, clients receive a standardized response format that enables predictable error handling.

**Design Rationale**: Inconsistent error formats across different failure modes create brittle client applications. A unified format reduces complexity in frontend error handling and provides better developer experience.

### Structured Error Classification

The system uses inheritance-based error classification with the `BaseApiError` abstract class serving as the foundation. This approach was chosen over simple error codes or message-based classification for several architectural reasons:

- **Type Safety**: TypeScript interfaces provide compile-time validation of error properties
- **Rich Context**: Each error type carries domain-specific metadata while maintaining consistency
- **Extensibility**: New error types can inherit base behavior while adding specialized functionality

### Fail-Fast vs Resilient Processing

The architecture employs a **dual strategy** for error handling:

- **403 Errors (Authorization)**: Fail-fast approach stops batch operations immediately
- **Other Errors**: Resilient processing continues with partial success responses

**Reasoning**: Authorization failures indicate systemic permission issues that won't resolve within a single request. Other errors may be transient or item-specific, making partial success valuable.

## Architectural Components

### 1. Error Hierarchy Design

```typescript
BaseApiError                    // Abstract foundation
├── MicroserviceError          // Backend service failures
├── ServiceValidationError     // Input validation failures
├── ResourceNotFoundError      // Missing resource scenarios
└── AuthenticationError        // Authentication/authorization failures
```

**Why This Structure**:

- **Single Responsibility**: Each error type handles one failure category
- **Consistent Logging**: Shared logging context through base class
- **Response Uniformity**: Common serialization patterns while allowing specialization

### 2. Middleware Placement Strategy

The error handler middleware is strategically positioned **after API routes but before Angular SSR**:

```typescript
app.use('/api/projects', projectsRouter);
app.use('/api/committees', committeesRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/*', apiErrorHandler); // API errors only
app.use('/**', angularAppHandler); // SSR for everything else
```

**Architectural Reasoning**:

- **Separation of Concerns**: API errors are handled differently than SSR errors
- **Error Context**: API errors need structured JSON responses; SSR errors need HTML pages
- **Performance**: Avoids error handler overhead for static asset requests

### 3. Logging Integration Architecture

#### Dual Logger Pattern

The system maintains **two distinct logger instances**:

- **Server Logger** (`serverLogger`): Global application events, startup, shutdown
- **Request Logger** (`req.log`): Request-scoped with correlation IDs

**Design Decision**: This separation allows for different log formats and destinations while maintaining request traceability. Server events don't need request context, while API operations require correlation.

#### Structured Context Enrichment

Error logging automatically enriches context with:

- Request metadata (ID, path, method, user agent)
- Error classification (type, code, severity)
- Operation context (service, path, metadata)

**Why This Approach**: Centralized enrichment ensures consistent log structure without duplicating logic across controllers.

### 4. Security-First Error Response Design

#### Information Disclosure Prevention

The architecture employs **layered information filtering**:

1. **Sensitive Data Redaction**: Automatic removal of tokens, passwords, emails from logs
2. **Error Message Sanitization**: Generic messages for server errors to prevent information leakage
3. **Development vs Production**: Different redaction levels based on environment

**Security Philosophy**: Errors should help legitimate users while revealing minimal information to potential attackers.

#### Error Response Boundaries

```typescript
// Client receives
{
  error: "User-friendly message",
  code: "ERROR_CODE",
  service: "service_name"
}

// Logs contain
{
  error_type: "MicroserviceError",
  original_error: "Detailed technical message",
  request_id: "correlation-id"
}
```

### 5. Authentication Error Handling

The `AuthenticationError` class handles authentication and authorization failures:

**Key Features**:

- **401 Status Code**: Indicates authentication required
- **Public Endpoint Support**: Used for passcode validation on public meeting routes
- **Session Management**: Works with protected routes middleware for session handling
- **Clear Messaging**: Provides user-friendly authentication error messages

**Implementation Location**: `apps/lfx-one/src/server/errors/authentication.error.ts`

## Design Patterns and Rationales

### 1. Factory Pattern for Error Creation

`MicroserviceError.fromMicroserviceResponse()` factory method abstracts error construction complexity:

**Benefits**:

- **Consistent Transformation**: Standardizes backend error mapping
- **Message Prioritization**: Smart selection of user vs technical messages
- **Future Evolution**: Central point for enhancing error transformation logic

### 2. Type Guards for Error Detection

Type guard functions (`isBaseApiError`, `isMicroserviceError`) enable safe error handling:

**Architectural Value**:

- **Type Safety**: Runtime type checking with TypeScript support
- **Middleware Flexibility**: Clean branching logic for different error types
- **Testing**: Easier mocking and test scenarios

### 3. Context Preservation Pattern

Errors maintain **rich contextual metadata**:

- `operation`: What was being attempted
- `service`: Which component failed
- `path`: Request path for traceability
- `metadata`: Operation-specific data

**Why Context Matters**: Debugging distributed systems requires understanding not just what failed, but what was being attempted and in what context.

## Performance Considerations

### 1. Error Processing Overhead

- **Stack Trace Capture**: Only in development (V8 optimization)
- **Metadata Collection**: Lazy evaluation where possible
- **Serialization**: Minimal object transformation for responses

### 2. Batch Operation Resilience

For operations processing multiple items:

- **Parallel Processing**: Failed items don't block successful ones
- **Partial Success**: 207 Multi-Status responses for partial failures
- **Fail-Fast Authorization**: Immediate termination for permission issues

**Trade-off**: Slightly increased complexity for significantly better user experience and system resilience.

## Integration Strategies

### 1. Microservice Error Passthrough

Backend service errors are **transformed, not masked**:

- Preserve original error codes and status codes
- Maintain error details when safe to expose
- Add service context for debugging

**Philosophy**: The server acts as an intelligent proxy, enriching rather than replacing error information.

### 2. Validation Error Harmonization

Frontend validation errors match backend validation error format:

```typescript
{
  field: "email",
  message: "Invalid email format",
  code: "FIELD_VALIDATION_ERROR"
}
```

**Consistency Value**: Unified client-side error handling regardless of validation source.

### 3. Authentication Integration

Auth0 errors are handled through the broader error system while maintaining security boundaries:

- Token refresh failures become structured errors
- Authorization failures trigger appropriate HTTP responses
- Session state errors are logged with proper context

## Future Extensibility Considerations

### 1. Error Classification Evolution

The base error class design accommodates:

- **New Error Types**: Additional inheritance without breaking existing code
- **Enhanced Metadata**: New fields can be added while maintaining backward compatibility
- **Custom Error Codes**: Domain-specific codes while preserving HTTP semantics

### 2. Monitoring Integration Readiness

The structured logging format supports:

- **APM Integration**: Error rates, response times, failure patterns
- **Alerting**: Configurable thresholds based on error severity
- **Distributed Tracing**: Request correlation across services

### 3. Multi-Tenant Error Handling

Architecture supports future multi-tenancy through:

- **Context Enrichment**: Tenant information can be added to all error contexts
- **Error Isolation**: Tenant-specific error handling without core changes
- **Privacy Boundaries**: Different redaction rules per tenant

## Key Architectural Decisions Summary

1. **Structured over Ad-hoc**: Consistent error objects over simple strings
2. **Classification over Generic**: Typed errors over generic error handling
3. **Context-Rich over Minimal**: Detailed logging for observability
4. **Security by Design**: Built-in sensitive data protection
5. **Resilience over Perfection**: Partial success over all-or-nothing
6. **Separation of Concerns**: Different error handling for different application layers

This architecture prioritizes maintainability, observability, and user experience while maintaining strong security boundaries and system performance.

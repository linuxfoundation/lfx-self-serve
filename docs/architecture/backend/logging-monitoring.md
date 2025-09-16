# Logging & Monitoring

## 📝 Pino Logging System

The application uses Pino for high-performance structured logging with automatic request logging and security redaction.

## 🔧 Pino Configuration

### Dual Logger Architecture

The application uses a dual logger architecture for optimal performance and flexibility:

#### Server Logger (Base Logger)

```typescript
// apps/lfx-one/src/server/server.ts
import pino from 'pino';

/**
 * Base Pino logger instance for server-level operations.
 * Used for server startup/shutdown, direct logging from server code,
 * and can be imported by other modules for consistent logging.
 */
const serverLogger = pino({
  level: process.env['LOG_LEVEL'] || 'info',
  redact: {
    paths: ['access_token', 'refresh_token', 'authorization', 'cookie'],
    remove: true,
  },
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

#### HTTP Logger (Request Middleware)

```typescript
/**
 * HTTP request/response logging middleware using Pino.
 * Provides request-scoped logger accessible via req.log in route handlers.
 */
const httpLogger = pinoHttp({
  logger: serverLogger, // Uses same base logger for consistency
  autoLogging: {
    ignore: (req: Request) => {
      return req.url === '/health' || req.url === '/api/health';
    },
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    remove: true,
  },
  level: 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Add HTTP logger middleware after health endpoint
app.use(httpLogger);
```

### Key Features

- **Dual Logger Architecture**: Separate loggers for server operations and HTTP requests
- **Shared Configuration**: Consistent formatting and settings across both loggers
- **Environment-Based Levels**: Configurable log levels via LOG_LEVEL environment variable
- **High Performance**: Pino is optimized for speed and low overhead
- **Structured Logging**: JSON output with uppercase level formatting
- **Security Redaction**: Automatically removes sensitive headers and tokens
- **Health Check Filtering**: Excludes health endpoints from logs
- **Request Correlation**: Automatic request ID generation
- **Modular Design**: Server logger can be exported and reused in other modules

## 📊 Logging Configuration

### Environment Variables

```bash
# Set log level for both server and HTTP loggers
LOG_LEVEL=info  # Options: trace, debug, info, warn, error, fatal

# Other environment variables affecting logging
NODE_ENV=production  # Affects stack trace inclusion in logs
```

### Security Redaction

#### Server Logger Redaction

```typescript
// Server-level sensitive data redaction
redact: {
  paths: [
    'access_token',     // OAuth access tokens
    'refresh_token',    // OAuth refresh tokens
    'authorization',    // Authorization headers
    'cookie'           // Cookie data
  ],
  remove: true,  // Completely removes instead of showing [Redacted]
}
```

#### HTTP Logger Redaction

```typescript
// HTTP request/response sensitive data redaction
redact: {
  paths: [
    'req.headers.authorization',    // Bearer tokens
    'req.headers.cookie',          // Session cookies
    'res.headers["set-cookie"]'    // Set-Cookie headers
  ],
  remove: true,  // Completely removes instead of showing [Redacted]
}
```

### Formatting Configuration

```typescript
// Consistent formatting across both loggers
formatters: {
  level: (label) => {
    return { level: label.toUpperCase() };  // INFO, ERROR, WARN, etc.
  },
},
timestamp: pino.stdTimeFunctions.isoTime,  // ISO 8601 timestamps
```

### Health Check Filtering

```typescript
// Avoid logging noise from health checks
autoLogging: {
  ignore: (req: Request) => {
    return req.url === '/health' || req.url === '/api/health';
  },
}
```

## 🔍 Request Logging

### Automatic HTTP Logging

Pino-http automatically logs:

```json
{
  "level": 30,
  "time": 1640995200000,
  "pid": 12345,
  "hostname": "server-name",
  "req": {
    "id": "req-1",
    "method": "GET",
    "url": "/project/kubernetes",
    "headers": {
      "user-agent": "Mozilla/5.0...",
      "accept": "text/html,application/xhtml+xml"
    },
    "remoteAddress": "127.0.0.1",
    "remotePort": 56789
  },
  "res": {
    "statusCode": 200,
    "headers": {
      "content-type": "text/html; charset=utf-8"
    }
  },
  "responseTime": 42,
  "msg": "request completed"
}
```

## 🚨 Error Logging

### Application Error Handling

#### Angular SSR Error Logging

```typescript
// Enhanced error logging in main request handler
.catch((error) => {
  req.log.error(
    {
      error: error.message,
      code: error.code,
      url: req.url,
      method: req.method,
      user_agent: req.get('User-Agent'),
    },
    'Error rendering Angular application'
  );

  if (error.code === 'NOT_FOUND') {
    res.status(404).send('Not Found');
  } else if (error.code === 'UNAUTHORIZED') {
    res.status(401).send('Unauthorized');
  } else {
    res.status(500).send('Internal Server Error');
  }
});
```

#### API Error Handler Integration

```typescript
// API error handler middleware with enhanced logging
export function apiErrorHandler(error: ApiError, req: Request, res: Response, next: NextFunction): void {
  // Log unhandled errors using request logger
  req.log.error(
    {
      error: error.message,
      path: req.path,
      method: req.method,
      user_agent: req.get('User-Agent'),
      error_name: error.name,
      status_code: error.status || 500,
    },
    'Unhandled API error'
  );

  // Return structured error response
  res.status(error.status || 500).json({
    error: error.status ? error.message : 'Internal server error',
    code: error.code || 'INTERNAL_ERROR',
    path: req.path,
  });
}
```

### Enhanced Error Log Format

#### Angular SSR Error Log

```json
{
  "level": "ERROR",
  "time": "2024-01-01T12:00:00.000Z",
  "pid": 12345,
  "hostname": "server-name",
  "req": {
    "id": "req-1",
    "method": "GET",
    "url": "/problematic-route"
  },
  "error": "Something went wrong",
  "code": "INTERNAL_ERROR",
  "stack": "Error: Something went wrong\n    at handler (/app/server.js:123:45)",
  "url": "/problematic-route",
  "method": "GET",
  "user_agent": "Mozilla/5.0 (compatible; browser)",
  "msg": "Error rendering Angular application"
}
```

#### API Error Log

```json
{
  "level": "ERROR",
  "time": "2024-01-01T12:00:00.000Z",
  "pid": 12345,
  "hostname": "server-name",
  "req": {
    "id": "req-2",
    "method": "POST",
    "url": "/api/projects"
  },
  "error": "Validation failed",
  "stack": "ValidationError: Required field missing\n    at validator (/app/api.js:45:12)",
  "path": "/api/projects",
  "method": "POST",
  "user_agent": "Mozilla/5.0 (compatible; browser)",
  "error_name": "ValidationError",
  "status_code": 400,
  "msg": "Unhandled API error"
}
```

## 📈 Health Monitoring & Server Startup

### Health Check Endpoint

```typescript
// Simple health check endpoint (added before logger middleware)
app.get('/health', (_req: Request, res: Response) => {
  res.send('OK');
});
```

### Health Check Response

```text
GET /health
Response: 200 OK
Body: OK
```

### Server Startup Logging

```typescript
// Enhanced server startup logging
export function startServer() {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    serverLogger.info(
      {
        port,
        url: `http://localhost:${port}`,
        node_env: process.env['NODE_ENV'] || 'development',
        pm2: process.env['PM2'] === 'true',
      },
      'Node Express server started'
    );
  });
}
```

### Server Startup Log Format

```json
{
  "level": "INFO",
  "time": "2024-01-01T12:00:00.000Z",
  "pid": 12345,
  "hostname": "server-name",
  "port": 4000,
  "url": "http://localhost:4000",
  "node_env": "production",
  "pm2": true,
  "msg": "Node Express server started"
}
```

## 🔧 Production Considerations

### Log Level Configuration

```typescript
// Environment-based log level configuration
const serverLogger = pino({
  level: process.env['LOG_LEVEL'] || 'info', // Configurable via environment
  // ... other config
});
```

### Logger Export and Reusability

```typescript
/**
 * Export server logger for use in other modules that need logging
 * outside of the HTTP request context (e.g., startup scripts, utilities).
 */
export { serverLogger };

// Usage in other modules:
// import { serverLogger } from './server/server';
// serverLogger.info({ data }, 'Module operation completed');
```

### Log Rotation (Recommended)

For production deployments, consider log rotation:

```bash
# Example with PM2 log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

### Container Logging

When running in containers, logs go to stdout/stderr:

```dockerfile
# Dockerfile - logs to stdout
CMD ["node", "dist/lfx-one/server/server.mjs"]
```

## 🎯 Request Correlation

### Automatic Request IDs

Pino-http automatically generates request IDs for correlation:

```json
{
  "req": {
    "id": "req-1", // Automatic request correlation ID
    "method": "GET",
    "url": "/project/kubernetes"
  }
}
```

### Using Request Logger vs Server Logger

#### Request-Scoped Logging (req.log)

```typescript
// Use req.log for request-specific operations
app.use('/api/projects', (req: Request, res: Response, next: NextFunction) => {
  req.log.info({ projectId: req.params.id }, 'Processing project request');
  // ... rest of handler
});
```

#### Server-Level Logging (serverLogger)

```typescript
// Use serverLogger for operations outside request context
import { serverLogger } from './server/server';

// Startup operations
serverLogger.info({ config: 'loaded' }, 'Configuration initialized');

// Background tasks
serverLogger.warn({ task: 'cleanup' }, 'Background cleanup completed');
```

#### When to Use Each Logger

- **req.log**: HTTP request handling, API operations, user actions
- **serverLogger**: Server startup/shutdown, background tasks, module initialization

## 📊 Log Analysis

### JSON Structure Benefits

- **Searchable**: Easy to search by field (method, status, url)
- **Filterable**: Filter by log level, time range, error type
- **Parseable**: Standard JSON format for log aggregation tools
- **Structured**: Consistent field names across all logs

### Example Log Queries

```bash
# Filter by status code
cat logs.json | jq 'select(.res.statusCode >= 400)'

# Filter by response time
cat logs.json | jq 'select(.responseTime > 1000)'

# Filter by specific routes
cat logs.json | jq 'select(.req.url | startswith("/api/"))'
```

## 🔒 Security Features

### Data Protection

- **Header Redaction**: Authorization and cookie headers removed
- **Sensitive Path Filtering**: Configurable redaction paths
- **Complete Removal**: Sensitive data completely removed, not just masked

### Audit Trail

- **Request Tracking**: Every request logged with unique ID
- **Error Tracking**: All errors logged with full context
- **Performance Tracking**: Response times logged for monitoring

## 📈 Performance Impact

### Pino Performance Benefits

- **Fast Serialization**: Optimized JSON serialization
- **Asynchronous**: Non-blocking logging operations
- **Low Memory**: Minimal memory footprint
- **Child Logger Support**: Efficient logger inheritance

### Minimal Overhead

```typescript
// Pino is designed for production use with minimal performance impact
// Typical overhead: <1% CPU, <10MB memory for high-traffic applications
```

## 🔧 Current Implementation Status

### ✅ Implemented Features

- **Dual Logger Architecture**: Separate server and HTTP loggers
- **Environment Configuration**: LOG_LEVEL environment variable support
- **Enhanced Error Handling**: API error handler middleware integration
- **Server Startup Logging**: Comprehensive server initialization logging
- **Security Redaction**: Multiple layers of sensitive data protection
- **Exportable Logger**: Server logger available for module imports
- **Consistent Formatting**: Uppercase levels and ISO timestamps
- **Conditional Stack Traces**: Production-safe error logging
- **Request Correlation**: Automatic request ID generation
- **Health Check Filtering**: Excluded from request logs

### 🔲 Not Yet Implemented

- Custom log levels for different components
- Log aggregation service integration
- Metrics collection endpoints
- Performance monitoring dashboards
- Alert system integration
- Log retention policies

This logging system provides a solid foundation for monitoring application behavior and troubleshooting issues in both development and production environments.

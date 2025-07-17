# Logging & Monitoring

## 📝 Pino Logging System

The application uses Pino for high-performance structured logging with automatic request logging and security redaction.

## 🔧 Pino Configuration

### Current Implementation

```typescript
// apps/lfx-pcc/src/server/server.ts
import pinoHttp from 'pino-http';

const logger = pinoHttp({
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
});

// Add logger middleware after health endpoint to avoid logging health checks
app.use(logger);
```

### Key Features

- **High Performance**: Pino is optimized for speed and low overhead
- **Structured Logging**: JSON output for easy parsing and analysis
- **Security Redaction**: Automatically removes sensitive headers
- **Health Check Filtering**: Excludes health endpoints from logs
- **Request Correlation**: Automatic request ID generation

## 📊 Logging Configuration

### Security Redaction

```typescript
// Sensitive data automatically redacted
redact: {
  paths: [
    'req.headers.authorization',    // Bearer tokens
    'req.headers.cookie',          // Session cookies
    'res.headers["set-cookie"]'    // Set-Cookie headers
  ],
  remove: true,  // Completely removes instead of showing [Redacted]
}
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

```typescript
// Error logging in main request handler
.catch((error) => {
  req.log.error({ error }, 'Error rendering Angular application');

  if (error.code === 'NOT_FOUND') {
    res.status(404).send('Not Found');
  } else if (error.code === 'UNAUTHORIZED') {
    res.status(401).send('Unauthorized');
  } else {
    res.status(500).send('Internal Server Error');
  }
});
```

### Error Log Format

```json
{
  "level": 50,
  "time": 1640995200000,
  "pid": 12345,
  "hostname": "server-name",
  "req": {
    "id": "req-1",
    "method": "GET",
    "url": "/problematic-route"
  },
  "error": {
    "type": "Error",
    "message": "Something went wrong",
    "stack": "Error: Something went wrong\n    at handler (/app/server.js:123:45)"
  },
  "msg": "Error rendering Angular application"
}
```

## 📈 Health Monitoring

### Health Check Endpoint

```typescript
// Simple health check endpoint
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

## 🔧 Production Considerations

### Log Level Configuration

```typescript
// Development vs Production logging
const logger = pinoHttp({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  // ... other config
});
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
CMD ["node", "dist/lfx-pcc/server/server.mjs"]
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

### Using Request Logger

```typescript
// Access the request logger in handlers
app.use('/**', (req: Request, res: Response, next: NextFunction) => {
  // req.log is available for custom logging
  req.log.info({ customData: 'value' }, 'Custom log message');

  // ... rest of handler
});
```

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

- Pino-http middleware integration
- Automatic request/response logging
- Security header redaction
- Health check filtering
- Error logging with context
- JSON structured output

### 🔲 Not Yet Implemented

- Custom log levels for different components
- Log aggregation service integration
- Metrics collection endpoints
- Performance monitoring dashboards
- Alert system integration
- Log retention policies

This logging system provides a solid foundation for monitoring application behavior and troubleshooting issues in both development and production environments.

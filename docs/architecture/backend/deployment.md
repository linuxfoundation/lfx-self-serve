# Deployment

## 🚀 PM2 Process Management

The application uses PM2 for production process management with cluster mode and automatic restart capabilities.

## 🔧 PM2 Configuration

### Production Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'lfx-pcc',
      script: 'apps/lfx-pcc/dist/lfx-pcc/server/server.mjs',
      env: {
        PM2: 'true',
        NODE_ENV: 'production',
        PORT: 4200,
      },
      max_restarts: 10, // Restart limit for unstable apps
      exp_backoff_restart_delay: 100, // Exponential backoff restart delay
      watch: false, // Disable file watching in production
      autorestart: true, // Auto restart on crashes
      instances: 1, // Number of instances to run
      exec_mode: 'cluster', // Enable cluster mode for load balancing
    },
  ],
};
```

### Key Configuration Features

- **Cluster Mode**: Enables load balancing across CPU cores
- **Auto Restart**: Automatically restarts on crashes
- **Restart Limits**: Prevents infinite restart loops
- **Exponential Backoff**: Delays restarts to allow recovery
- **Environment Variables**: Production-specific configuration

## 📦 Build Process

### Production Build

```bash
# Build the application for production
yarn build

# Expected output structure
dist/lfx-pcc/
├── browser/          # Client-side assets
│   ├── index.html
│   ├── main.[hash].js
│   ├── styles.[hash].css
│   └── assets/
└── server/           # Server-side bundle
    └── server.mjs    # Main server entry point
```

### Build Commands

```bash
# Build for production
yarn build

# Verify build output
ls -la apps/lfx-pcc/dist/lfx-pcc/
```

## 🏗 Server Detection

### PM2 Environment Detection

```typescript
// apps/lfx-pcc/src/server/server.ts
const metaUrl = import.meta.url;
const isMain = isMainModule(metaUrl);
const isPM2 = process.env['PM2'] === 'true';

if (isMain || isPM2) {
  startServer();
}
```

### Server Startup Logic

- **Development**: Starts when run directly (`node server.mjs`)
- **Production**: Starts when PM2 environment detected
- **CLI Integration**: Compatible with Angular CLI dev server

## 🔄 Production Commands

### PM2 Process Management

```bash
# Start the application
yarn start:prod
# Equivalent to: pm2 start ecosystem.config.js

# Reload with zero downtime
yarn reload:prod
# Equivalent to: pm2 reload lfx-pcc

# View logs
yarn logs:prod
# Equivalent to: pm2 logs lfx-pcc

# Stop the application
pm2 stop lfx-pcc

# Delete the process
pm2 delete lfx-pcc

# Monitor processes
pm2 monit
```

### Process Status

```bash
# Check process status
pm2 status
┌─────┬──────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id  │ name     │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
├─────┼──────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 0   │ lfx-pcc  │ default     │ 1.0.0   │ cluster │ 12345    │ 2m     │ 0    │ online    │ 0.1%     │ 45.2mb   │ app      │ disabled │
└─────┴──────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
```

## 🌐 Server Configuration

### Port Configuration

```typescript
// Server listens on configured port
export function startServer() {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    logger.logger.info(`Node Express server listening on http://localhost:${port}`);
  });
}
```

### Environment Variables

```bash
# Production environment variables
NODE_ENV=production
PORT=4200
PM2=true

# Auth0 configuration
PCC_AUTH0_SECRET='production-secret'
PCC_BASE_URL='https://pcc.lfx.dev'
PCC_AUTH0_ISSUER_BASE_URL='https://linuxfoundation.auth0.com'
PCC_AUTH0_CLIENT_ID='production-client-id'
PCC_AUTH0_CLIENT_SECRET='production-client-secret'
PCC_AUTH0_AUDIENCE='https://api.lfx.dev'
```

## 🔧 Cluster Mode Benefits

### Load Distribution

- **CPU Utilization**: Distributes load across available CPU cores
- **Memory Isolation**: Each worker has isolated memory space
- **Fault Tolerance**: Single worker crash doesn't affect others
- **Zero Downtime**: Rolling restarts maintain service availability

### Scaling Configuration

```javascript
// Scale to use all CPU cores
{
  instances: 'max',  // Use all available CPU cores
  exec_mode: 'cluster'
}

// Scale to specific number
{
  instances: 4,      // Run 4 instances
  exec_mode: 'cluster'
}
```

## 📊 Monitoring and Health

### Built-in Health Check

```typescript
// Health endpoint excludes PM2 monitoring noise
app.get('/health', (_req: Request, res: Response) => {
  res.send('OK');
});
```

### PM2 Monitoring

```bash
# Real-time monitoring
pm2 monit

# Process information
pm2 show lfx-pcc

# Resource usage
pm2 status
```

## 🔄 Restart Strategies

### Automatic Restart

```javascript
{
  autorestart: true,              // Enable auto restart
  max_restarts: 10,               // Limit restart attempts
  exp_backoff_restart_delay: 100  // Exponential backoff delay
}
```

### Manual Restart Options

```bash
# Graceful restart (zero downtime)
pm2 reload lfx-pcc

# Hard restart
pm2 restart lfx-pcc

# Restart all processes
pm2 restart all
```

## 🔐 Security Considerations

### Process Isolation

- **User Permissions**: Run with minimal required privileges
- **File System**: Restrict file system access
- **Network**: Bind only to required interfaces
- **Environment**: Isolate environment variables

### Security Headers

```typescript
// Security headers handled in application
// See SSR server documentation for details
```

## 📈 Performance Optimization

### Memory Management

```javascript
{
  max_memory_restart: '500M',  // Restart if memory exceeds limit
  node_args: '--max_old_space_size=512'  // Node.js memory limit
}
```

### CPU Optimization

```javascript
{
  instances: 'max',           // Use all CPU cores
  exec_mode: 'cluster',       // Enable load balancing
  watch: false               // Disable file watching overhead
}
```

## 🛠 Troubleshooting

### Common Issues

```bash
# Check logs for errors
pm2 logs lfx-pcc --lines 100

# Restart if stuck
pm2 restart lfx-pcc

# Check process status
pm2 status

# Monitor resource usage
pm2 monit
```

### Log Analysis

```bash
# View application logs
pm2 logs lfx-pcc

# View error logs only
pm2 logs lfx-pcc --err

# Clear logs
pm2 flush
```

## 🔧 Current Deployment Status

### ✅ Implemented Features

- PM2 cluster mode configuration
- Automatic restart with backoff
- Production environment detection
- Health check endpoint
- Zero-downtime reload capability
- Resource monitoring

### 🔲 Not Yet Implemented

- Automated deployment pipeline
- Load balancer configuration
- SSL/TLS termination
- Container orchestration
- Blue-green deployment
- Automated backup strategies

This deployment configuration provides a robust foundation for running the LFX PCC application in production with high availability and fault tolerance.

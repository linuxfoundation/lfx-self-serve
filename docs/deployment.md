# Deployment Guide

## 🚢 Production Build & Deployment

### Build Process

```bash
# Build SSR application
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

### PM2 Process Manager

**PM2** is a production-grade process manager for Node.js applications that provides:

- **Process Management**: Automatic restarts, clustering, and monitoring
- **Zero-Downtime Deployments**: Graceful reloads without service interruption
- **Log Management**: Centralized logging with rotation and real-time viewing
- **Monitoring**: Built-in monitoring dashboard and metrics collection
- **Load Balancing**: Built-in cluster mode for multi-core utilization

#### PM2 Configuration

**Configuration**: `ecosystem.config.js`

```javascript
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

#### Key Configuration Features

- **Cluster Mode**: Enables load balancing across CPU cores
- **Auto Restart**: Automatically restarts on crashes
- **Restart Limits**: Prevents infinite restart loops
- **Exponential Backoff**: Delays restarts to allow recovery
- **Environment Variables**: Production-specific configuration

#### PM2 Commands

```bash
# Start the application
yarn start:server
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

# Check process status
pm2 status
```

#### Server Detection and Startup

```typescript
// apps/lfx-pcc/src/server/server.ts
const metaUrl = import.meta.url;
const isMain = isMainModule(metaUrl);
const isPM2 = process.env['PM2'] === 'true';

if (isMain || isPM2) {
  startServer();
}

export function startServer() {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    logger.logger.info(`Node Express server listening on http://localhost:${port}`);
  });
}
```

- **Development**: Starts when run directly (`node server.mjs`)
- **Production**: Starts when PM2 environment detected
- **CLI Integration**: Compatible with Angular CLI dev server

## 🐳 Deployment Options

### 1. Node.js Server with SSR

- **Build**: `yarn build`
- **Start**: `yarn start:server` or `node dist/lfx-pcc/server/server.mjs`
- **Features**: Includes Express server for API proxy and authentication
- **Port**: Exposes port 4200

### 2. Docker Deployment

The application uses a multi-stage Docker build process defined in `/Dockerfile-changelog`:

**Build Process**:

- **Stage 1 (Builder)**: Node.js 22 Alpine with Yarn for building the application
- **Stage 2 (Production)**: Lightweight Node.js 22 Alpine for running the application

**Key Features**:

- Multi-stage build for optimized image size
- Corepack-enabled Yarn for package management
- Configurable build environment (`BUILD_ENV` argument)
- Exposes port 4000 for the SSR server
- Production-only dependencies in final image

**Docker Commands**:

```bash
# Build the image
docker build -f /path/to/Dockerfile-changelog -t lfx-pcc .

# Run the container
docker run -p 4000:4000 lfx-pcc

# Build for specific environment
docker build --build-arg BUILD_ENV=prod -f Dockerfile-changelog -t lfx-pcc .
```

### 3. CI/CD Pipeline (AWS ECS)

The application uses GitHub Actions for automated deployment to AWS ECS:

**Pipeline Features**:

- **Automated Builds**: Triggered on pushes to `main` branch or PR changes
- **Security Scanning**: TruffleHog scans for secrets in Docker images
- **Container Registry**: AWS ECR for image storage
- **ECS Deployment**: AWS Fargate for serverless container execution
- **Environment Management**: Separate dev/prod deployments with AWS Secrets Manager

**Deployment Workflow** (`.github/workflows/deploy-changelog-dev.yml`):

1. **Build**: Multi-stage Docker build with environment-specific configurations
2. **Security Scan**: TruffleHog analysis for embedded secrets
3. **Push**: Image pushed to AWS ECR with SHA-based tags
4. **Deploy**: ECS task definition updated with new image
5. **Service Update**: Forced deployment triggers rolling update

**AWS Infrastructure**:

- **ECS Cluster**: `lfx-pcc`
- **ECS Service**: `lfx-pcc-service`
- **Task Definition**: 1024 CPU, 2048 MB memory on Fargate
- **Secrets Management**: AWS Secrets Manager for sensitive configuration
- **Logging**: CloudWatch logs with `/ecs/lfx-pcc-logs` group

## ⚙️ Environment Variables

### Authentication Architecture

The application uses a dual authentication system:

1. **User Authentication**: For protected routes requiring user login (Auth0/Authelia)
2. **M2M Authentication**: For server-side API calls from public endpoints

This allows public routes (like `/meetings/:id`) to serve content without user authentication while still making authenticated backend API calls.

### Required Production Variables

```bash
# Application Configuration
NODE_ENV=production

# Environment Configuration
ENV=development
PCC_BASE_URL=http://localhost:4200
LOG_LEVEL=info

# User Authentication Configuration (Auth0/Authelia)
# Get these values from your Auth0 dashboard
PCC_AUTH0_CLIENT_ID=your-auth0-client-id
PCC_AUTH0_CLIENT_SECRET=your-auth0-client-secret
PCC_AUTH0_ISSUER_BASE_URL=https://auth.k8s.orb.local/
PCC_AUTH0_AUDIENCE=http://lfx-api.k8s.orb.local/
PCC_AUTH0_SECRET=sufficiently-long-string

# Machine-to-Machine (M2M) Authentication
# For server-side API calls from public endpoints
M2M_AUTH_CLIENT_ID=your-m2m-client-id
M2M_AUTH_CLIENT_SECRET=your-m2m-client-secret
M2M_AUTH_ISSUER_BASE_URL=https://auth.k8s.orb.local/
M2M_AUTH_AUDIENCE=http://lfx-api.k8s.orb.local/

# Microservice Configuration
# URL and JWT token for the query service
LFX_V2_SERVICE=http://lfx-api.k8s.orb.local

# Supabase Database Configuration
# Get these from your Supabase project settings
SUPABASE_URL=https://your-project.supabase.co
POSTGRES_API_KEY=your-supabase-anon-key
SUPABASE_STORAGE_BUCKET=your-supabase-bucket-name

# NATS Configuration
# Internal k8s service DNS for NATS cluster
NATS_URL=nats://lfx-platform-nats.lfx.svc.cluster.local:4222

# AI Service Configuration
# OpenAI-compatible proxy for meeting agenda generation
AI_PROXY_URL=https://litellm.tools.lfx.dev/chat/completions
AI_API_KEY=your-ai-api-key

# E2E Test Configuration (Optional)
# Test user credentials for automated testing
TEST_USERNAME=your-test-username
TEST_PASSWORD=your-test-password

# LOCAL ONLY FOR AUTHELIA
NODE_TLS_REJECT_UNAUTHORIZED=0
```

## 🔧 Production Setup Steps

### 1. Application Deployment

```bash
# Clone repository
git clone <your-repo>
cd lfx-pcc

# Install dependencies
yarn install

# Build for production
yarn build

# Start with PM2
yarn start:server
```

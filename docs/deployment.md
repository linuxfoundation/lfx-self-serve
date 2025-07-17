# Deployment Guide

## 🚢 Production Build & Deployment

### Build Process

```bash
# Build SSR application
yarn build

# Start with PM2 process manager
yarn start:server
```

### PM2 Process Manager

**PM2** is a production-grade process manager for Node.js applications that provides:

- **Process Management**: Automatic restarts, clustering, and monitoring
- **Zero-Downtime Deployments**: Graceful reloads without service interruption
- **Log Management**: Centralized logging with rotation and real-time viewing
- **Monitoring**: Built-in monitoring dashboard and metrics collection
- **Load Balancing**: Built-in cluster mode for multi-core utilization

**Configuration**: `ecosystem.config.js`

```javascript
module.exports = {
  apps: [
    {
      name: 'lfx-pcc',
      script: 'dist/lfx-pcc/server/server.mjs',
      env: {
        PM2: 'true',
      },
      max_restarts: 10, // Restart limit for unstable apps
      exp_backoff_restart_delay: 100, // Exponential backoff restart delay
      watch: false, // Disable file watching in production
      autorestart: true, // Auto restart on crashes
    },
  ],
};
```

**PM2 Commands**:

```bash
pm2 start ecosystem.config.js    # Start application
pm2 restart lfx-pcc         # Restart gracefully
pm2 reload lfx-pcc          # Zero-downtime reload
pm2 stop lfx-pcc            # Stop application
pm2 logs lfx-pcc            # View logs
pm2 monit                        # Real-time monitoring
```

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

### Required Production Variables

```bash
# Database Configuration
# Auth0 Configuration
AUTH0_DOMAIN=your-auth0-domain
AUTH0_CLIENT_ID=your-auth0-client-id
AUTH0_CLIENT_SECRET=your-auth0-client-secret

# Application Configuration
NODE_ENV=production
PORT=4200
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

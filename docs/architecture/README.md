# LFX PCC Architecture Documentation

## 🏗 System Overview

LFX PCC is a modern Angular 19 SSR application with Auth0 authentication, built using experimental zoneless change detection and a comprehensive design system.

### Architecture Stack

- **Frontend**: Angular 19 with SSR, Angular Signals, PrimeNG UI components
- **Backend**: Express.js SSR server with Auth0 authentication
- **Styling**: Tailwind CSS v3 with LFX UI Core design system
- **Build**: Turborepo monorepo with shared TypeScript packages

## 📚 Documentation Sections

### 🎨 [Frontend Architecture](./frontend/)

- [Angular Patterns](./frontend/angular-patterns.md) - Angular 19, signals, zoneless change detection
- [Component Architecture](./frontend/component-architecture.md) - PrimeNG wrappers, layout patterns
- [Styling System](./frontend/styling-system.md) - CSS layers, Tailwind, LFX UI Core
- [State Management](./frontend/state-management.md) - Angular signals, service patterns
- [Performance](./frontend/performance.md) - SSR, build optimizations

### ⚙️ [Backend Architecture](./backend/)

- [Authentication](./backend/authentication.md) - Auth0 integration, user management
- [SSR Server](./backend/ssr-server.md) - Express.js server, Angular engine
- [Logging & Monitoring](./backend/logging-monitoring.md) - Pino logging, health checks
- [Deployment](./backend/deployment.md) - PM2, environment configuration

### 📦 [Shared Architecture](./shared/)

- [Package Architecture](./shared/package-architecture.md) - Monorepo structure, shared types
- [Development Workflow](./shared/development-workflow.md) - Patterns, conventions, tooling

### 🧪 [Testing Architecture](./testing/)

- [Unit Testing](./testing/unit-testing.md) - Angular testing patterns
- [Integration Testing](./testing/integration-testing.md) - Component integration tests
- [E2E Testing](./testing/e2e-testing.md) - End-to-end testing strategy

## 🚀 Quick Start

```bash
# Install dependencies
yarn install

# Start development server
yarn start

# Build for production
yarn build

# Run tests
yarn test
```

## 🔗 Related Documentation

- [Deployment Guide](../deployment.md)
- [Testing Guide](../testing.md)
- [Troubleshooting](../troubleshooting.md)
- [CLAUDE.md](../../CLAUDE.md) - Development guidelines

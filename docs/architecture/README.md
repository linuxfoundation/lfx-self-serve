# Architecture Documentation

## 🏗 System Overview

LFX PCC v2 UI is a modern Angular 19 SSR application built with experimental zoneless change detection, featuring a sophisticated backend architecture and comprehensive design system integration.

## 📖 Architecture Documentation Guide

### 🎨 Frontend Architecture

- **[Frontend Overview](./frontend/README.md)** - Angular 19 architecture with zoneless change detection
- **[Angular Patterns](./frontend/angular-patterns.md)** - Modern Angular 19 development patterns with signals
- **[Component Architecture](./frontend/component-architecture.md)** - PrimeNG wrapper components and design patterns
- **[Styling System](./frontend/styling-system.md)** - CSS layers, Tailwind, and LFX UI Core integration
- **[State Management](./frontend/state-management.md)** - Angular Signals and reactive programming
- **[Performance](./frontend/performance.md)** - SSR, build optimizations, and performance strategies
- **[Lazy Loading Strategy](./frontend/lazy-loading-preloading-strategy.md)** - Route optimization and code splitting

### 🖥 Backend Architecture

- **[Backend Overview](./backend/README.md)** - Express.js with Controller-Service pattern
- **[SSR Server](./backend/ssr-server.md)** - Angular Universal and Express.js configuration
- **[Authentication](./backend/authentication.md)** - Auth0 integration and JWT handling
- **[Logging & Monitoring](./backend/logging-monitoring.md)** - Pino structured logging and monitoring
- **[AI Service](./backend/ai-service.md)** - Claude Sonnet integration for meeting agenda generation
- **[NATS Integration](./backend/nats-integration.md)** - Inter-service messaging and project resolution
- **[Error Handling](./backend/error-handling-architecture.md)** - Comprehensive error handling patterns

### 📦 Shared Package Architecture

- **[Shared Package Overview](./shared/README.md)** - Centralized types and constants
- **[Package Architecture](./shared/package-architecture.md)** - Interface patterns and module design
- **[Development Workflow](./shared/development-workflow.md)** - Hot reloading and build processes

### 🧪 Testing Architecture

- **[E2E Testing](./testing/e2e-testing.md)** - Comprehensive end-to-end testing with dual architecture
- **[Testing Best Practices](./testing/testing-best-practices.md)** - Testing patterns and implementation guide

## 🎯 Quick Navigation by Use Case

### New Developer Onboarding

1. **[System Overview](../architecture.md)** - Start here for complete technical overview
2. **[Development Setup](../../CLAUDE.md)** - Environment setup and development patterns
3. **[Frontend Overview](./frontend/README.md)** - Frontend architecture and patterns
4. **[Backend Overview](./backend/README.md)** - Backend architecture and services

### Frontend Development

1. **[Angular Patterns](./frontend/angular-patterns.md)** - Modern Angular 19 patterns
2. **[Component Architecture](./frontend/component-architecture.md)** - Component patterns and wrappers
3. **[Styling System](./frontend/styling-system.md)** - CSS, Tailwind, and design system
4. **[State Management](./frontend/state-management.md)** - Angular Signals patterns

### Backend Development

1. **[Backend Overview](./backend/README.md)** - Architecture and patterns
2. **[SSR Server](./backend/ssr-server.md)** - Express.js and SSR setup
3. **[Authentication](./backend/authentication.md)** - Auth0 integration
4. **[AI Service](./backend/ai-service.md)** - AI integration patterns

### Testing & Quality

1. **[E2E Testing](./testing/e2e-testing.md)** - Playwright testing with dual architecture
2. **[Testing Best Practices](./testing/testing-best-practices.md)** - Testing patterns and guidelines
3. **[Performance](./frontend/performance.md)** - Performance optimization strategies

### DevOps & Deployment

1. **[Deployment Guide](../deployment.md)** - Production deployment with PM2
2. **[Logging & Monitoring](./backend/logging-monitoring.md)** - Production monitoring
3. **[Error Handling](./backend/error-handling-architecture.md)** - Error management

## 🔧 Technology Stack Summary

### Frontend

- **Angular 19** with experimental zoneless change detection
- **Angular Signals** for reactive state management
- **PrimeNG 19** with custom LFX UI Core preset
- **Tailwind CSS v3** with CSS layers architecture

### Backend

- **Express.js** server with Angular Universal SSR
- **Auth0** authentication integration
- **Pino** structured JSON logging
- **PM2** production process management

### Development Tools

- **Turborepo** monorepo build system
- **TypeScript** strict mode with path mappings
- **ESLint** with Angular-specific rules
- **Playwright** for E2E testing

## 📚 Related Documentation

- **[Main Project README](../../README.md)** - Project overview and getting started
- **[Development Guide](../../CLAUDE.md)** - Claude Code assistant and development patterns
- **[Troubleshooting](../troubleshooting.md)** - Common issues and solutions
- **[Testing Guide](./testing/e2e-testing.md)** - Comprehensive E2E testing with Playwright

---

_This documentation reflects the current state of the LFX v2 UI application architecture. For questions or updates, please refer to the project's JIRA board using project key LFXV2._

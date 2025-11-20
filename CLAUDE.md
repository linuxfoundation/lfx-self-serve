# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📋 Table of Contents

### 🏗 Architecture & Setup

- [Project Overview](#project-overview) - Turborepo monorepo with Angular 19 SSR
- [Monorepo Structure](#monorepo-structure) - Apps, packages, and organization
- [Application Architecture](#application-architecture) - Directory structure and patterns
- [Common Commands](#common-commands) - Development and production commands

### 🚀 Development Patterns

- [Angular 19 Development Patterns](#angular-19-development-patterns) - Zoneless change detection, signals, components
- [Component Organization Pattern](#component-organization-pattern) - Standardized component structure
- [Shared Package (@lfx-one/shared)](#shared-package-lfx-oneshared) - Types, interfaces, constants
- [PrimeNG Component Wrappers](#primeng-component-wrappers) - UI library abstraction
- [Path Mappings](#path-mappings) - Import aliases and conventions

### 🎨 UI & Layout

- [CSS Architecture & Styling](#css-architecture--styling) - Tailwind, fonts, theming

### 🔧 Technical Stack

- [Frontend Technologies](#frontend-technologies) - Angular 19, PrimeNG, Tailwind
- [Backend Stack](#backend-stack) - Express.js server with SSR
- [Development Tools](#development-tools) - ESLint, Prettier, Turborepo
- [Code Quality](#code-quality) - Linting and formatting standards

### 🚀 Operations

- [Authentication & Authorization](#authentication--authorization) - Auth0 integration
- [Logging](#logging) - Pino structured logging
- [Server-Side Rendering (SSR)](#server-side-rendering-ssr) - Angular 19 built-in SSR
- [Production Deployment](#production-deployment) - PM2, health checks
- [Testing](#testing) - Test framework and commands
- [Environment Configuration](#environment-configuration) - Dev/prod setup

### 📚 Documentation Links

- [Component Architecture](docs/architecture/frontend/component-architecture.md) - Detailed wrapper patterns
- [Angular Patterns](docs/architecture/frontend/angular-patterns.md) - Angular 19 development
- [Styling System](docs/architecture/frontend/styling-system.md) - CSS and theming
- [Authentication](docs/architecture/backend/authentication.md) - Auth0 setup
- [SSR Server](docs/architecture/backend/ssr-server.md) - Server-side rendering
- [Logging & Monitoring](docs/architecture/backend/logging-monitoring.md) - Structured logging
- [E2E Testing](docs/architecture/testing/e2e-testing.md) - Comprehensive end-to-end testing with dual architecture
- [Testing Best Practices](docs/architecture/testing/testing-best-practices.md) - Testing patterns and implementation guide

### 💡 Quick Reference

- [Application Flow](#application-flow) - User journey and navigation
- [Current State & Development Roadmap](#current-state--development-roadmap) - Implementation status
- [Development Memories](#development-memories) - Important reminders and patterns

## Project Overview

LFX One is a Turborepo monorepo containing an Angular 19 SSR application with experimental zoneless change detection and Express.js server.

## Monorepo Structure

```text
lfx-v2-ui/
├── apps/
│   └── lfx-one/              # Angular 19 SSR application with zoneless change detection
│       ├── eslint.config.mjs # Angular-specific ESLint rules
│       ├── .prettierrc       # Prettier configuration with Tailwind integration
│       └── tailwind.config.js # Tailwind with PrimeUI plugin and LFX colors
├── packages/
│   └── shared/               # Shared types, interfaces, constants, and enums
│       ├── src/
│       │   ├── interfaces/   # TypeScript interfaces for components, auth, projects
│       │   ├── constants/    # Design tokens (colors, font-sizes)
│       │   └── enums/        # Shared enumerations
│       ├── package.json      # Package configuration with proper exports
│       └── tsconfig.json     # TypeScript configuration
├── docs/                     # Architecture and deployment documentation
├── turbo.json               # Turborepo pipeline configuration
├── ecosystem.config.js      # PM2 production configuration
└── package.json             # Root workspace configuration
```

[... rest of the existing content remains unchanged ...]

## Development Memories

- Always reference PrimeNG's component interface when trying to define types
- The project logo display is currently hardcoded but will be dynamic once API is integrated
- Metrics data is hardcoded but structured to match future API responses
- All PrimeNG components are wrapped in LFX components for UI library independence
- Always use direct imports for standalone components - no barrel exports
- **Authentication uses selective pattern** - public routes bypass auth, protected routes require authentication
- **Public routes include** `/meeting` and `/public/api` endpoints
- **M2M tokens are used** for server-side API calls from public endpoints
- **Protected routes middleware** handles selective authentication logic
- **Custom login handler** at `/login` with URL validation and secure redirects
- Authentication is handled by Auth0/Authelia with express-openid-connect middleware
- **Logging System**: Uses Pino for structured JSON logs with sensitive data redaction
- **Logger Helper Pattern**: All controller functions must use Logger helper methods:
  - `Logger.start(req, 'operation_name', metadata)` - Returns startTime, logs at INFO
  - `Logger.success(req, 'operation_name', startTime, metadata)` - Logs at INFO
  - `Logger.error(req, 'operation_name', startTime, error, metadata)` - Logs at ERROR with 'err' field
  - `Logger.warning(req, 'operation_name', message, metadata)` - Logs at WARN
  - `Logger.validation(req, 'operation_name', errors, metadata)` - Logs at WARN
- **Error Logging Standard**: Always use `err` field for errors to leverage Pino's error serializer
  - ✅ Correct: `req.log.error({ err: error, ...metadata }, 'message')`
  - ✅ Correct: `serverLogger.error({ err: error }, 'message')`
  - ✅ Correct: `Logger.error(req, 'operation', startTime, error, metadata)`
  - ❌ Incorrect: `{ error: error.message }` or `{ error: error instanceof Error ? error.message : error }`
  - Benefits: Complete stack traces (production/debug), clean single-line errors (development), proper AWS CloudWatch format
  - Custom serializer: `/server/helpers/error-serializer.ts` - excludes verbose stacks in dev, includes in prod
- **Log Level Guidelines** (What to log at each level):
  - **INFO**: Business operation completions (created, updated, deleted), successful data retrieval (fetched, retrieved)
  - **WARN**: Error conditions leading to exceptions, data quality issues, user not found, fallback behaviors
  - **DEBUG**: Internal operations, preparation steps (sanitizing, creating payload), intent statements (resolving, fetching), NATS lookups
  - **ERROR**: System failures, unhandled exceptions, critical errors requiring immediate attention
- **Filtered URLs**: Health checks (/health, /api/health) and /.well-known URLs are not logged to reduce noise
- All shared types, interfaces, and constants are centralized in @lfx-one/shared package
- **AI Service Integration**: Claude Sonnet 4 model via LiteLLM proxy for meeting agenda generation
- **AI Environment Variables**: AI_PROXY_URL and AI_API_KEY required for AI functionality
- **M2M Environment Variables**: M2M_AUTH_CLIENT_ID, M2M_AUTH_CLIENT_SECRET for machine-to-machine auth
- Use TypeScript interfaces instead of union types for better maintainability
- Shared package uses direct source imports during development for hot reloading
- **Interfaces go into the shared packages**
- **License headers are required on all source files** - run `./check-headers.sh` to verify
- **Pre-commit hooks enforce license headers** - commits will fail without proper headers
- Always run yarn format from the root of the project to ensure formatting is done after you have made all your changes
- Always preprend "Generated with [Claude Code](https://claude.ai/code)" if you assisted with the code
- Do not nest ternary expressions
- Always run yarn lint before yarn build to validate your linting
- The JIRA project key for this is LFXV2. All tickets associated to this repo should generally be in there.
- **E2E tests use dual architecture** - both content-based (_.spec.ts) and structural (_-robust.spec.ts) tests
- **Always add data-testid attributes** when creating new components for reliable test targeting
- **Run yarn e2e before major changes** to ensure all 85+ tests pass consistently
- **Use data-testid naming convention** - `[section]-[component]-[element]` for hierarchical structure
- **Test responsive behavior** - validate mobile, tablet, and desktop viewports appropriately
- When running tests to validate UI tests, use reporter=list
- Follow Angular commit conventions: `type(scope): description`
- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Scope should be lowercase and describe the affected area (e.g., auth, ui, api, docs) and follow the angular scope conventions
- Use present tense, imperative mood: "add feature" not "added feature"
- Examples:
  - `feat(auth): add OAuth2 integration`
  - `fix(ui): resolve mobile button alignment`
- All commits and pull requests need to be associated to a JIRA ticket. If there isn't one, we need to create it and reference it moving forward.
- Branch names should be following the commit types (feat,fix,docs, etc) followed by the JIRA ticket number. i.e; feat/LFXV2-123 or ci/LFXV2-456
- PR titles must also follow a similar format as conventional commits - `type(scope): description`. The scope has to follow the angular config for conventional commit and not include the JIRA ticket in the title, and everything should be in lowercase.
- All interfaces, reusable constants, and enums should live in the shared package.

## Commit Workflow with JIRA Tracking

Before starting any work or commits:

1. **Check if there is a JIRA ticket** we always want to track our work. Do not use discarded or resolved tickets
2. **Create JIRA ticket if needed** for untracked work
3. **Include JIRA ticket in commit message** (e.g., LFXV2-XXX)
4. **Link PR to JIRA ticket** when creating pull requests

- Always use sequential thinking mcp for planning before doing any changes
- Always run yarn build to validate that your changes are building too for validation
- Always remember that our JIRA sprint field is customfield_10020. When we create tickets, we need to assign them to the current user and set it to the current sprint.

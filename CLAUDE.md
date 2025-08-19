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
- [Shared Package (@lfx-pcc/shared)](#shared-package-lfx-pccshared) - Types, interfaces, constants
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

LFX PCC is a Turborepo monorepo containing an Angular 19 SSR application with experimental zoneless change detection and Express.js server.

## Monorepo Structure

```text
lfx-pcc-v3/
├── apps/
│   └── lfx-pcc/              # Angular 19 SSR application with zoneless change detection
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
- Authentication is handled by Auth0 with express-openid-connect middleware
- Logging uses Pino for structured JSON logs with sensitive data redaction
- Health checks are available at /health and are not logged or authenticated
- All shared types, interfaces, and constants are centralized in @lfx-pcc/shared package
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
- Before you do any work, MUST view files in `.claude/tasks/context_session_x.md` file to get the full context (x being the id of the session we are operating in, if file doesn't exist, then create one)
- `.claude/tasks/context_session_x.md` should contain most of context of what we did, overall plan, and sub agents will continuously add context to the file
- After you finish the work, MUST update the `.claude/tasks/context_session_x.md` file to make sure others can get full context of what you did

## Claude Code Subagent System

This project uses specialized Claude Code subagents for complex tasks. Follow these rules when working with subagents:

### Context Management Rules

- **Always maintain project context** in `.claude/tasks/context_session_x.md`
- **Read context file first** before starting any task to understand current project state
- **Update context file** after completing research or implementation to share findings
- **Use context template** from `.claude/tasks/context_session_x.md` for new projects

### Available Subagents

- **Angular UI Expert** (`angular-ui-expert`): Specialized in Angular 19, signals, PrimeNG, and LFX component architecture
  - Use for: UI/UX research, component planning, Angular patterns, responsive design
  - Configuration: `.claude/agents/angular-ui-expert.md`

- **JIRA Project Manager** (`jira-project-manager`): Manages JIRA ticket lifecycle and ensures proper tracking
  - Use for: Creating tickets, updating status, linking PRs, validating work is tracked
  - Configuration: `.claude/agents/jira-project-manager.md`

### When to Use Subagents

- Complex multi-step UI implementations
- Research-heavy tasks requiring specialized knowledge
- Architecture decisions requiring expert analysis
- Planning phases before implementation

### Subagent Workflow

1. **Parent agent creates context file** with project requirements and current state
2. **Delegate to specialized subagent** with specific research/planning task
3. **Use jira-project-manager to ensure work is tracked** before making any changes or commits
4. **Subagent researches and creates detailed plan** (no implementation)
5. **Parent agent reads plan and executes implementation** with full context
6. **Update context file** with progress and decisions

### Subagent Rules

- Subagents should **NEVER implement code directly** - only research and plan
- Always **read context file first** to understand project scope
- Create **detailed implementation plans** in markdown format
- **Save research reports** in `.claude/doc/` directory
- **Update context file** after completing research

## Commit Workflow with JIRA Tracking

Before making any commits:

1. **Use jira-project-manager subagent** to validate changes are properly tracked
2. **Create JIRA ticket if needed** for untracked work
3. **Include JIRA ticket in commit message** (e.g., LFXV2-XXX)
4. **Link PR to JIRA ticket** when creating pull requests

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

## Component Organization Pattern

All Angular components should follow this standardized organization pattern for consistency and maintainability:

### Structure Overview

```typescript
export class ComponentName {
  // 1. Injected services (readonly)
  private readonly serviceOne = inject(ServiceOne);
  private readonly serviceTwo = inject(ServiceTwo);

  // 2. Class variables with explicit types
  private dialogRef: DialogRef | undefined;
  public someSignal: WritableSignal<Type>;
  public someComputed: Signal<Type>;
  public someForm: FormGroup;
  public someArray: Type[];

  constructor() {
    // 3. Initialize all class variables by calling private methods
    this.someSignal = signal<Type>(initialValue);
    this.someComputed = this.initializeSomeComputed();
    this.someForm = this.initializeSomeForm();
    this.someArray = this.initializeSomeArray();
  }

  // 4. Public methods (lifecycle, event handlers, etc.)
  public onSomeEvent(): void {}
  public somePublicMethod(): void {}

  // 5. Private methods (business logic)
  private somePrivateMethod(): void {}
  private handleSomeAction(): void {}

  // 6. Private initialization methods (at the end of class)
  private initializeSomeComputed(): Signal<Type> {
    return computed(() => {
      /* logic */
    });
  }

  private initializeSomeForm(): FormGroup {
    return new FormGroup({
      /* controls */
    });
  }

  private initializeSomeArray(): Type[] {
    return [
      /* initial values */
    ];
  }
}
```

### Key Benefits

- **Clear variable declarations** with types at the top
- **Organized constructor** that only handles initialization calls
- **Separation of concerns** between declaration and initialization
- **Improved readability** and maintainability
- **Better testability** with isolated initialization methods
- **Consistent code structure** across the entire application

### Implementation Rules

1. **Always declare variables with explicit types** before constructor
2. **Use constructor only for initialization** - no complex logic
3. **Create private initialization methods** for complex setup
4. **Group related variables together** (signals, forms, arrays, etc.)
5. **Place initialization methods at the end** of the class
6. **Use descriptive method names** like `initializeSearchForm()`

### Example: Committee Dashboard

See `apps/lfx-pcc/src/app/modules/project/committees/committee-dashboard/committee-dashboard.component.ts` for a complete implementation following this pattern.

## Testing

The project uses a comprehensive E2E testing strategy with Playwright, featuring a dual architecture approach:

### Test Commands

- `yarn e2e` - Run all E2E tests across all browsers
- `yarn e2e --project=chromium` - Run tests on Chromium only
- `yarn e2e --project="Mobile Chrome"` - Run tests on Mobile Chrome only
- `yarn e2e --reporter=list` - Run tests with detailed output
- `yarn e2e --headed` - Run tests in headed mode (visible browser)

### Test Architecture

**Dual Testing Approach:**

- **Content-Based Tests** (`*.spec.ts`) - Validate user experience and visible content
- **Structural Tests** (`*-robust.spec.ts`) - Validate component architecture and framework integration

**Current Coverage:**

- **85+ tests** across homepage and project dashboard
- **Multi-browser support** (Chromium, Firefox, Mobile Chrome)
- **Responsive testing** with viewport-aware assertions
- **Data-testid architecture** for reliable element targeting

### Key Testing Features

- **Authentication Flow** - Global Auth0 setup with session management
- **Angular Integration** - Signals, computed values, and component testing
- **Mobile-First** - Responsive design validation across viewports
- **Robust Selectors** - Data-testid attributes that survive UI changes
- **Error Handling** - Graceful failure handling and debugging support

### Test Maintenance

- All tests should pass consistently (currently 85/85 passing)
- Use data-testid attributes for reliable element selection
- Follow naming conventions: `[section]-[component]-[element]`
- Include both user experience and technical validation
- Update tests when adding new features or components

For detailed testing guidelines, see [E2E Testing Documentation](docs/architecture/testing/e2e-testing.md) and [Testing Best Practices](docs/architecture/testing/testing-best-practices.md).

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

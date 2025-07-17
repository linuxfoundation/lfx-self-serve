# LFX PCC

This is a Turborepo monorepo for the LFX PCC (Linux Foundation Experience Platform Community Contribution) application, built with Angular 19 and experimental zoneless change detection.

## What's inside?

This Turborepo includes the following app:

### Apps and Packages

- `apps/lfx-pcc`: Angular 19 SSR application with zoneless change detection and direct PrimeNG UI components

The app is 100% [TypeScript](https://www.typescriptlang.org/).

### Architecture

- **Frontend**: Angular 19 with experimental zoneless change detection, Angular Signals, PrimeNG components, Tailwind CSS
- **UI Framework**: PrimeNG 19 with custom LFX UI Core preset and Tailwind CSS integration
- **Styling**: Tailwind CSS v3 with PrimeUI plugin, CSS layers architecture, Google Fonts (Open Sans + Roboto Slab)
- **Icons**: Font Awesome Pro via kits (no npm packages)
- **Backend**: Express.js server with Angular 19 SSR, Auth0 authentication, Pino logging
- **Infrastructure**: PM2 process management for production deployment

### Development Tools

This Turborepo has comprehensive development tooling:

- **[TypeScript](https://www.typescriptlang.org/)** for static type checking with strict configuration
- **[ESLint](https://eslint.org/)** for code linting with Angular 19 specific rules
- **[Prettier](https://prettier.io)** for code formatting with Tailwind class sorting
- **[Turborepo](https://turborepo.com/)** for efficient monorepo builds and caching
- **[PM2](https://pm2.keymetrics.io/)** for production process management

## Development

### Getting Started

```bash
# Install dependencies
yarn install

# Start development server (Angular dev server)
yarn start

# Build the application
yarn build

# Run tests
yarn test
```

### Code Quality Commands

```bash
# Linting
yarn lint           # Lint and auto-fix all packages
yarn lint:check     # Check linting without fixing

# Formatting
yarn format         # Format code with Prettier
yarn format:check   # Check formatting without fixing

# Testing
yarn test           # Run unit tests
yarn test:watch     # Run tests in watch mode
```

### Common Commands

```bash
# Development
yarn start          # Start Angular dev server (ng serve)
yarn build          # Build the application
yarn watch          # Build in watch mode

# Production
yarn serve:ssr      # Serve SSR application locally
yarn start:prod     # Start with PM2 in production
yarn reload:prod    # Zero-downtime reload
yarn logs:prod      # View PM2 logs
```

### Working with the application

You can run commands for the application using Turborepo filters:

```bash
# Start the Angular app
yarn start --filter=lfx-pcc

# Build the Angular app
yarn build --filter=lfx-pcc

# Run tests for the app
yarn test --filter=lfx-pcc

# Lint the app
yarn lint --filter=lfx-pcc
```

## Project Structure

```text
lfx-pcc-v3/
├── apps/
│   └── lfx-pcc/              # Angular 19 SSR application
│       ├── src/app/config/   # Tailwind custom configurations
│       │   └── styles/       # Colors and font-size configurations
│       ├── eslint.config.mjs # Angular-specific ESLint rules
│       ├── .prettierrc       # Prettier with Tailwind integration
│       └── tailwind.config.js # Tailwind with PrimeUI plugin
├── docs/                     # Architecture and deployment documentation
├── turbo.json               # Turborepo pipeline configuration
├── ecosystem.config.js      # PM2 production configuration
└── package.json             # Root workspace configuration
```

## Key Features

### Angular 19 with Zoneless Change Detection

- **Experimental zoneless change detection** for improved performance
- **Angular Signals** for reactive state management (preferred over RxJS)
- **Standalone components** with explicit imports
- **Component prefix**: All components use `lfx-` prefix (enforced by ESLint)

### CSS Architecture

- **CSS Layers**: Organized layer system (`tailwind-base, primeng, tailwind-utilities`)
- **PrimeNG Integration**: Custom preset using LFX UI Core design system
- **Tailwind CSS**: Utility-first styling with PrimeUI plugin integration
- **Custom Fonts**: Google Fonts (Open Sans + Roboto Slab) with CSS variables

### Direct PrimeNG Usage

- **PrimeNG Components**: Direct integration of PrimeNG components with LFX theming
- **Custom Styling**: PrimeNG components styled with LFX UI Core design system
- **Template Support**: Full access to PrimeNG template functionality
- **Type Safety**: Full TypeScript support with PrimeNG type definitions

### Code Quality

- **ESLint**: Angular 19 specific rules with import organization and naming conventions
- **Prettier**: Automatic code formatting with Tailwind class sorting
- **TypeScript**: Strict configuration with path mappings (`@app/*`, `@config/*`)
- **Testing**: Angular testing framework with comprehensive coverage

## Deployment

The application supports deployment with PM2:

1. **Node.js with PM2**: Production process management with clustering and zero-downtime deployments

See the [deployment documentation](docs/architecture/backend/deployment.md) for detailed instructions.

## 📚 Documentation

### Architecture Documentation

Comprehensive documentation organized by domain:

#### 🎨 [Frontend Architecture](docs/architecture/frontend/)

- **[Angular Patterns](docs/architecture/frontend/angular-patterns.md)** - Zoneless change detection, SSR, and Angular 19 features
- **[Component Architecture](docs/architecture/frontend/component-architecture.md)** - PrimeNG wrappers, layout patterns, and component hierarchy
- **[Styling System](docs/architecture/frontend/styling-system.md)** - CSS layers, Tailwind configuration, and LFX UI Core
- **[State Management](docs/architecture/frontend/state-management.md)** - Angular Signals patterns and service architecture
- **[Performance](docs/architecture/frontend/performance.md)** - SSR optimization, build strategies, and monitoring

#### 🖥 [Backend Architecture](docs/architecture/backend/)

- **[SSR Server](docs/architecture/backend/ssr-server.md)** - Express.js configuration and Angular 19 SSR integration
- **[Authentication](docs/architecture/backend/authentication.md)** - Auth0 integration with express-openid-connect
- **[Logging & Monitoring](docs/architecture/backend/logging-monitoring.md)** - Pino logging, structured logs, and health monitoring
- **[Deployment](docs/architecture/backend/deployment.md)** - PM2 configuration and production deployment

#### 📦 [Shared Architecture](docs/architecture/shared/)

- **[Package Architecture](docs/architecture/shared/package-architecture.md)** - Shared interfaces, constants, and TypeScript types
- **[Development Workflow](docs/architecture/shared/development-workflow.md)** - Turborepo configuration and monorepo patterns

#### 🧪 [Testing Architecture](docs/architecture/testing/)

- **[Unit Testing](docs/architecture/testing/unit-testing.md)** - Component and service testing with Angular Signals
- **[Integration Testing](docs/architecture/testing/integration-testing.md)** - API testing and service integration patterns
- **[E2E Testing](docs/architecture/testing/e2e-testing.md)** - Playwright configuration and user workflow testing

### Quick Start Guides

- **[📋 Main Architecture Overview](docs/architecture/README.md)** - High-level system overview and navigation
- **[⚡ Development Setup](CLAUDE.md)** - Claude Code assistant instructions and patterns

## Development Workflow

### Before Committing

Always run these commands before committing code:

```bash
yarn lint           # Fix linting issues
yarn format         # Format code consistently
yarn test           # Ensure all tests pass
yarn build          # Verify build succeeds
```

### Component Development

```bash
# Generate new component (will use lfx- prefix automatically)
ng generate component my-feature --standalone

# Generate service
ng generate service my-service

# Generate guard
ng generate guard my-guard
```

### Using PrimeNG Components

```typescript
// Import PrimeNG modules directly in your components
import { ButtonModule } from "primeng/button";
import { CardModule } from "primeng/card";

@Component({
  selector: "lfx-example",
  imports: [ButtonModule, CardModule],
  templateUrl: "./example.component.html",
  styleUrl: "./example.component.scss",
})
export class ExampleComponent {}
```

```html
<!-- example.component.html -->
<p-card header="Example Card">
  <p-button label="Click me" severity="primary"></p-button>
</p-card>
```

## Remote Caching

Turborepo can use [Remote Caching](https://turborepo.com/docs/core-concepts/remote-caching) to share cache artifacts across machines, speeding up builds for your team.

To enable Remote Caching:

```bash
# Authenticate with Vercel
yarn dlx turbo login

# Link your Turborepo to your Remote Cache
yarn dlx turbo link
```

## Technology Stack

### Frontend

- **Angular 19** with experimental zoneless change detection
- **Angular Signals** for state management
- **PrimeNG 19** UI component library with custom LFX preset
- **Tailwind CSS v3** with PrimeUI plugin
- **LFX UI Core** design system integration
- **Font Awesome Pro** icons (via kits)
- **Google Fonts** (Open Sans + Roboto Slab)

### Backend & Infrastructure

- **Express.js** server with Angular 19 SSR
- **Auth0** authentication with express-openid-connect
- **Pino** high-performance structured logging
- **PM2** for production process management and clustering

### Development Tools

- **Turborepo** for monorepo management
- **ESLint** with Angular-specific rules
- **Prettier** with Tailwind integration
- **TypeScript** with strict configuration
- **Angular CLI** for code generation

## Useful Links

Learn more about the technologies used:

- **[Turborepo Documentation](https://turborepo.com/docs)** - Monorepo build system
- **[Angular Documentation](https://angular.io/docs)** - Angular framework
- **[Angular Signals](https://angular.io/guide/signals)** - Reactive programming with Signals
- **[PrimeNG Components](https://primeng.org/)** - UI component library
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[LFX UI Core](https://github.com/linuxfoundation/lfx-ui-core)** - Linux Foundation design system
- **[PM2 Documentation](https://pm2.keymetrics.io/docs/)** - Process manager for Node.js

# LFX One

This is a monorepo for the LFX One application, built
with Angular 19 and experimental zoneless change detection.

## What's inside?

### Apps and Packages

- `apps/lfx-one`: Angular 19 SSR application with zoneless change detection and
  direct PrimeNG UI components

The app is 100% [TypeScript](https://www.typescriptlang.org/).

### Architecture

- **Frontend**: Angular 19 with experimental zoneless change detection, Angular
  Signals, PrimeNG components, Tailwind CSS
- **UI Framework**: PrimeNG 19 with custom LFX UI Core preset and Tailwind CSS integration
- **Styling**: Tailwind CSS v3 with PrimeUI plugin, CSS layers architecture,
  Google Fonts (Open Sans + Roboto Slab)
- **Icons**: Font Awesome Pro via kits (no npm packages)
- **Backend**: Express.js server with Angular 19 SSR, Auth0 authentication, Pino logging
- **Infrastructure**: PM2 process management for production deployment

### Development Tools

This has comprehensive development tooling:

- **[TypeScript](https://www.typescriptlang.org/)** for static type checking with strict configuration
- **[ESLint](https://eslint.org/)** for code linting with Angular 19 specific rules
- **[Prettier](https://prettier.io)** for code formatting with Tailwind class sorting
- **[Turborepo](https://turborepo.com/)** for efficient monorepo builds and caching
- **[PM2](https://pm2.keymetrics.io/)** for production process management

## Contributing

Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code
of conduct, development process, and how to submit pull requests.

## Development

### Getting Started

#### Prerequisites

- **Node.js** v22+ (specified in package.json)
- **Yarn** v4.9.2+ package manager
- **Auth0 Account** for authentication setup
- **Supabase Project** for user profile email management

#### Environment Setup

1. **Copy the environment template:**

   ```bash
   cp apps/lfx-one/.env.example apps/lfx-one/.env
   ```

2. **Configure required environment variables:**

   **Auth0 Configuration:**
   - Set `PCC_AUTH0_CLIENT_ID` and `PCC_AUTH0_CLIENT_SECRET`
     - Local Development: The default client ID is `lfx` and you can get the client secret from the k8s via `k get secrets authelia-clients -n lfx -o jsonpath='{.data.lfx}' | base64 --decode`
   - Update `PCC_AUTH0_ISSUER_BASE_URL` with your Auth0 domain
     - Local Development: `https://auth.k8s.orb.local`
   - Configure `PCC_AUTH0_AUDIENCE` for your API
     - Local Development: `http://lfx-api.k8s.orb.local/`
   - Set `PCC_AUTH0_SECRET` to a sufficiently long random string (32+ characters)
     - Generate a random 32 characters long string

   **M2M (Machine-to-Machine) Authentication:**
   - Set `M2M_AUTH_CLIENT_ID` and `M2M_AUTH_CLIENT_SECRET` for server-side API calls
   - Configure `M2M_AUTH_ISSUER_BASE_URL` (typically same as Auth0 base URL)
   - Set `M2M_AUTH_AUDIENCE` to match your API audience

   **Supabase Configuration:**
   - Create a project in [Supabase](https://supabase.com)
   - Get your project URL and anon key from Project Settings → API
   - Set `SUPABASE_URL` and `POSTGRES_API_KEY`
   - Used exclusively for user profile email management

   **Microservice Configuration:**
   - Set `LFX_V2_SERVICE` to your query service endpoint
     - Local Development: `http://lfx-api.k8s.orb.local`

   **AI Service Configuration (Optional):**
   - Set `AI_PROXY_URL` to your LiteLLM proxy endpoint for meeting agenda generation
   - Provide a valid API key in `AI_API_KEY`

   **NATS Configuration:**
   - Set `NATS_URL` for internal messaging system (typically in Kubernetes environments)
     - Local Development: `nats://lfx-platform-nats.lfx.svc.cluster.local:4222`

   **Testing Configuration (Optional):**
   - Set `TEST_USERNAME` and `TEST_PASSWORD` for automated E2E testing

   **Local Development:**
   - Set `NODE_TLS_REJECT_UNAUTHORIZED=0` when using Authelia for local authentication

#### Install and Run

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
yarn start --filter=lfx-one

# Build the Angular app
yarn build --filter=lfx-one

# Run tests for the app
yarn test --filter=lfx-one

# Lint the app
yarn lint --filter=lfx-one
```

## Project Structure

```text
lfx-one/
├── apps/
│   └── lfx-one/              # Angular 19 SSR application
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

1. **Node.js with PM2**: Production process management with clustering and
   zero-downtime deployments

See the [deployment documentation](docs/deployment.md) for detailed instructions.

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
- **[Deployment](docs/deployment.md)** - PM2 configuration and production deployment

#### 📦 [Shared Architecture](docs/architecture/shared/)

- **[Package Architecture](docs/architecture/shared/package-architecture.md)** - Shared interfaces, constants, and TypeScript types
- **[Development Workflow](docs/architecture/shared/development-workflow.md)** - Turborepo configuration and monorepo patterns

#### 🧪 [Testing Architecture](docs/architecture/testing/)

- **[E2E Testing](docs/architecture/testing/e2e-testing.md)** - Playwright configuration and user workflow testing
- **[Testing Best Practices](docs/architecture/testing/testing-best-practices.md)** - Testing patterns and implementation guide

### Quick Start Guides

- **[📋 Architecture Navigation Hub](docs/architecture/README.md)** - Complete architecture documentation guide
- **[⚡ Development Setup](CLAUDE.md)** - Claude Code assistant instructions and patterns
- **[🧪 Testing Guide](docs/architecture/testing/e2e-testing.md)** - Comprehensive E2E testing with Playwright

## Development Workflow

### Before Committing

Always run these commands before committing code:

```bash
yarn lint           # Fix code linting issues
yarn format         # Format code consistently
yarn test           # Ensure all tests pass
yarn build          # Verify build succeeds

# Use the GitHub CI job to check license headers
act -W .github/workflows/license-header-check.yml  # Verify license headers, requires container runtime

# Use the GitHub CI job to check markdown formatting
act -W .github/workflows/markdown-lint.yml # Check markdown formatting
```

**Note**: All source files must include the proper license header. See the [Contributing Guide](CONTRIBUTING.md#license-headers) for details.

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
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'lfx-example',
  imports: [ButtonModule, CardModule],
  templateUrl: './example.component.html',
  styleUrl: './example.component.scss',
})
export class ExampleComponent {}
```

```html
<!-- example.component.html -->
<p-card header="Example Card">
  <p-button label="Click me" severity="primary"></p-button>
</p-card>
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

## Useful Links

Learn more about the technologies used:

- **[Turborepo Documentation](https://turborepo.com/docs)** - Monorepo build system
- **[Angular Documentation](https://angular.io/docs)** - Angular framework
- **[Angular Signals](https://angular.io/guide/signals)** - Reactive programming with Signals
- **[PrimeNG Components](https://primeng.org/)** - UI component library
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[LFX UI Core](https://github.com/linuxfoundation/lfx-ui-core)** - Linux Foundation design system
- **[PM2 Documentation](https://pm2.keymetrics.io/docs/)** - Process manager for Node.js

## License

Copyright The Linux Foundation and each contributor to LFX.

This project’s source code is licensed under the MIT License. A copy of the
license is available in LICENSE.

This project’s documentation is licensed under the Creative Commons Attribution
4.0 International License \(CC-BY-4.0\). A copy of the license is available in
LICENSE-docs.

# LFX One

This is a monorepo for the LFX One application, built
with Angular 20 and stable zoneless change detection.

## What's inside?

### Apps and Packages

- `apps/lfx-one`: Angular 20 SSR application with stable zoneless change detection and
  direct PrimeNG UI components

The app is 100% [TypeScript](https://www.typescriptlang.org/).

### Architecture

- **Frontend**: Angular 20 with stable zoneless change detection, Angular
  Signals, PrimeNG components, Tailwind CSS
- **UI Framework**: PrimeNG 20 with custom LFX UI Core preset and Tailwind CSS integration
- **Styling**: Tailwind CSS v3 with PrimeUI plugin, CSS layers architecture,
  Google Fonts (Inter + Roboto Slab)
- **Icons**: Font Awesome Pro via kits (no npm packages)
- **Backend**: Express.js server with Angular 20 SSR, Auth0 authentication, Pino logging
- **Infrastructure**: PM2 process management for production deployment

### Development Tools

This has comprehensive development tooling:

- **[TypeScript](https://www.typescriptlang.org/)** for static type checking with strict configuration
- **[ESLint](https://eslint.org/)** for code linting with Angular 20 specific rules
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

   **API Gateway:**
   - Set `API_GW_AUDIENCE` to the audience for the secondary API Gateway access token
     - This token is fetched silently alongside the primary bearer token on each authenticated request
     - Local Development: `https://api-gw.dev.platform.linuxfoundation.org/`

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
yarn test           # Run unit tests (Karma)
yarn e2e            # Playwright E2E suite (headless)
yarn e2e:ui         # Playwright UI mode
```

### Common Commands

```bash
# Development
yarn start          # Start Angular dev server (ng serve)
yarn build          # Build the application
yarn watch          # Build in watch mode

# Production
yarn start:server   # Start SSR server via PM2 runtime
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
│   └── lfx-one/              # Angular 20 SSR application
│       ├── src/app/          # Feature modules, layouts, shared code
│       ├── src/server/       # Express SSR server (controllers, services, routes, middleware)
│       ├── e2e/              # Playwright E2E tests
│       ├── eslint.config.js  # Angular-specific ESLint rules
│       ├── .prettierrc.js    # Prettier with Tailwind integration
│       ├── ecosystem.config.js # PM2 production configuration
│       └── tailwind.config.js # Tailwind with PrimeUI plugin
├── packages/
│   └── shared/               # @lfx-one/shared — types, constants, enums, utils, validators
├── docs/                     # Architecture and deployment documentation
├── turbo.json                # Turborepo pipeline configuration
└── package.json              # Root workspace configuration
```

For the full directory breakdown (including `src/app/shared/` subdirs and `src/server/` layout) see [CLAUDE.md](CLAUDE.md) and [Architecture Overview](docs/architecture.md).

## Feature Modules

The application is organized into feature modules under `apps/lfx-one/src/app/modules/`:

| Module            | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| **badges**        | LFX badges — view and manage credentialing badges earned across projects         |
| **committees**    | Committee management — view, create, and manage project committees               |
| **dashboards**    | Lens-based dashboards (Me, Foundation, Project, Org) and supporting drawers      |
| **documents**     | Document management — browse and manage project documents                        |
| **events**        | Events — browse LFX events and manage attendance                                 |
| **mailing-lists** | Mailing list management — subscribe, unsubscribe, and manage lists               |
| **meetings**      | Meeting scheduling — create, manage, and join meetings with calendar integration |
| **profile**       | User profile — profile management and account settings                           |
| **settings**      | Application settings — preferences and configuration                             |
| **surveys**       | Survey management — create surveys, collect responses, view NPS analytics        |
| **trainings**     | Training enrollments — view and manage training programs                         |
| **transactions**  | Transactions — view billing / purchase history                                   |
| **votes**         | Voting system — create polls, cast votes, and view results                       |

## Key Features

### Angular 20 with Zoneless Change Detection

- **Stable zoneless change detection** for improved performance
- **Angular Signals** for reactive state management (preferred over RxJS)
- **Standalone components** with explicit imports
- **Component prefix**: All components use `lfx-` prefix (enforced by ESLint)

### CSS Architecture

- **CSS Layers**: Organized layer system (`tailwind-base, primeng, tailwind-utilities`)
- **PrimeNG Integration**: Custom preset using LFX UI Core design system
- **Tailwind CSS**: Utility-first styling with PrimeUI plugin integration
- **Custom Fonts**: Google Fonts (Inter + Roboto Slab) with CSS variables

### Direct PrimeNG Usage

- **PrimeNG Components**: Direct integration of PrimeNG components with LFX theming
- **Custom Styling**: PrimeNG components styled with LFX UI Core design system
- **Template Support**: Full access to PrimeNG template functionality
- **Type Safety**: Full TypeScript support with PrimeNG type definitions

### Code Quality

- **ESLint**: Angular 20 specific rules with import organization and naming conventions
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

The [Architecture Overview](docs/architecture.md) is the jumping-off point. Each canonical subtopic owns one file:

#### 🎨 [Frontend Architecture](docs/architecture/frontend/)

- **[Angular Patterns](docs/architecture/frontend/angular-patterns.md)** — Zoneless change detection, signals, control-flow syntax
- **[Component Architecture](docs/architecture/frontend/component-architecture.md)** — PrimeNG wrapper strategy, layouts, module organization
- **[Lens & Persona System](docs/architecture/frontend/lens-system.md)** — `LensService`, persona detection, `ProjectContextService`
- **[State Management](docs/architecture/frontend/state-management.md)** — Signal-first patterns, signal↔RxJS bridging
- **[Styling System](docs/architecture/frontend/styling-system.md)** — Tailwind + PrimeUI, CSS layers, font/color tokens
- **[Drawer Pattern](docs/architecture/frontend/drawer-pattern.md)** — Drawer components, lazy data, chart integration
- **[Lazy Loading & Preloading](docs/architecture/frontend/lazy-loading-preloading-strategy.md)** — Route splitting + custom preloading strategy
- **[Feature Flags](docs/architecture/frontend/feature-flags.md)** — OpenFeature + LaunchDarkly wiring, signal-reactive reads
- **[Performance](docs/architecture/frontend/performance.md)** — Bundle management, SSR, runtime patterns

#### 🖥 [Backend Architecture](docs/architecture/backend/)

- **[Backend Architecture](docs/architecture/backend/README.md)** — Controller-Service pattern, directory layout, core services
- **[SSR Server](docs/architecture/backend/ssr-server.md)** — Express + Angular SSR pipeline, middleware order
- **[Authentication](docs/architecture/backend/authentication.md)** — Auth0 setup, selective auth middleware, AuthContext, M2M tokens
- **[Impersonation](docs/architecture/backend/impersonation.md)** — Auth0 CTE flow, effective-identity helpers
- **[Rate Limiting](docs/architecture/backend/rate-limiting.md)** — `express-rate-limit` budgets for `/api`, `/public/api`, `/login`
- **[Observability](docs/architecture/backend/observability.md)** — OpenTelemetry auto-instrumentation and custom spans
- **[Logging & Monitoring](docs/architecture/backend/logging-monitoring.md)** — Logger service, operation lifecycle, log levels
- **[Error Handling](docs/architecture/backend/error-handling-architecture.md)** — Error class hierarchy, error-handler middleware
- **[Server Helpers](docs/architecture/backend/server-helpers.md)** — Validation type guards, pagination, URL validation
- **[Pagination](docs/architecture/backend/pagination.md)** — `page_token` cursor pattern, `fetchAllQueryResources` helper
- **[AI Service](docs/architecture/backend/ai-service.md)** — LiteLLM proxy, meeting agenda generation
- **[NATS Integration](docs/architecture/backend/nats-integration.md)** — Request/reply pattern, lazy connections
- **[Snowflake Integration](docs/architecture/backend/snowflake-integration.md)** — Singleton pool, query deduplication
- **[Public Meetings](docs/architecture/backend/public-meetings.md)** — Unauthenticated meeting access, M2M tokens
- **[Deployment](docs/deployment.md)** — PM2 configuration and production deployment

#### 📦 [Shared Architecture](docs/architecture/shared/)

- **[Package Architecture](docs/architecture/shared/package-architecture.md)** — `@lfx-one/shared` structure, import patterns, conventions
- **[Development Workflow](docs/architecture/shared/development-workflow.md)** — Turborepo, Yarn workspaces, build caching

#### 🧪 [Testing Architecture](docs/architecture/testing/)

- **[E2E Testing](docs/architecture/testing/e2e-testing.md)** — Dual-architecture spec files, `data-testid` naming, Playwright setup
- **[Testing Best Practices](docs/architecture/testing/testing-best-practices.md)** — Content vs. structural tests, robust locator patterns

### Quick Start Guides

- **[📋 Architecture Overview](docs/architecture.md)** — High-level map that links to every canonical doc above
- **[📋 Architecture Navigation Hub](docs/architecture/README.md)** — Same navigation from inside the `architecture/` directory
- **[🧪 Testing Guide](docs/architecture/testing/e2e-testing.md)** — Comprehensive E2E testing with Playwright
- **[🤖 CLAUDE.md](CLAUDE.md)** — Gotchas, conventions, and contextual rules for Claude Code sessions

## Development Workflow

### Before Committing

Pre-commit hooks (via husky + lint-staged) auto-format and lint staged files, then run `yarn format:check`, `yarn lint:check`, and `yarn check-types` across the whole repo — you don't need to run `yarn format` manually. Before opening a PR, sanity-check the full build and any broader linting:

```bash
yarn lint           # Auto-fix linting across the monorepo
yarn build          # Verify the production build
yarn e2e            # Run the Playwright E2E suite (when applicable)
```

Commit messages must follow Angular conventional-commit format and are validated by **commitlint** (`@commitlint/config-angular`). Commits must be signed off (`git commit -s`) to satisfy DCO — see the [Contributing Guide](CONTRIBUTING.md) for accepted types and sign-off details.

**Note**: All source files must include the MIT license header. `./check-headers.sh` validates locally and the pre-commit hook enforces it.

### Component Development

Angular 20 makes components, directives, and pipes standalone by default — do **not** pass `--standalone`, it's redundant and produces a deprecation warning:

```bash
ng generate component my-feature        # standalone is the default
ng generate service my-service
ng generate guard my-guard
```

### Using PrimeNG Components

Feature code can import `primeng/*` directly, but the preferred path for new code is the thin `lfx-*` wrapper components under `apps/lfx-one/src/app/shared/components/`. The wrappers give LFX One UI-library independence and a consistent signal-based API; several feature modules still import PrimeNG modules directly today, and migrating them to wrappers is an ongoing effort. When building a new feature, prefer the wrapper:

```typescript
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { CardComponent } from '@app/shared/components/card/card.component';

@Component({
  selector: 'lfx-example',
  imports: [ButtonComponent, CardComponent],
  templateUrl: './example.component.html',
})
export class ExampleComponent {}
```

```html
<!-- example.component.html -->
<lfx-card header="Example Card">
  <lfx-button label="Click me" severity="primary" (onClick)="handleClick()" />
</lfx-card>
```

See the [Component Architecture](docs/architecture/frontend/component-architecture.md) doc for the wrapper pattern in full and for guidance on when to add a new wrapper vs. import PrimeNG directly.

## Technology Stack

### Frontend

- **Angular 20** with stable zoneless change detection
- **Angular Signals** for state management
- **PrimeNG 20** UI component library with custom LFX preset
- **Tailwind CSS v3** with PrimeUI plugin
- **LFX UI Core** design system integration
- **Font Awesome Pro** icons (via kits)
- **Google Fonts** (Inter + Roboto Slab)

### Backend & Infrastructure

- **Express.js** server with Angular 20 SSR
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

This project's source code is licensed under the MIT License. A copy of the
license is available in LICENSE.

This project's documentation is licensed under the Creative Commons Attribution
4.0 International License \(CC-BY-4.0\). A copy of the license is available in
LICENSE-docs.

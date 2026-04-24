# Contributing to LFX One

Contributions are what make the open-source community such an amazing place to learn, inspire, and create.

Thank you for your interest in contributing to LFX One! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [License Headers](#license-headers)
- [Code Style](#code-style)
- [Architecture Guidelines](#architecture-guidelines)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)

## Code of Conduct

By participating in this project, you agree to abide by the [Linux Foundation Code of Conduct](https://www.linuxfoundation.org/code-of-conduct/).

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Create a new branch for your feature or bug fix
4. Make your changes
5. Push your changes to your fork
6. Submit a pull request

## Development Setup

Please refer to the [README.md](README.md) for detailed setup instructions.

## License Headers

**IMPORTANT**: All source code files must include the appropriate license header. This is enforced by our CI/CD pipeline.

### Required Format

The license header must appear in the first 4 lines of every source file and must contain the exact text:

```text
Copyright The Linux Foundation and each contributor to LFX.
SPDX-License-Identifier: MIT
```

### File Type Examples

#### TypeScript/JavaScript Files (.ts, .js)

```typescript
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Your code here...
```

#### HTML Files (.html)

```html
<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

<!-- Your HTML here... -->
```

#### CSS/SCSS Files (.css, .scss)

```css
/* Copyright The Linux Foundation and each contributor to LFX. */
/* SPDX-License-Identifier: MIT */

/* Your styles here... */
```

#### YAML Files (.yml, .yaml)

```yaml
# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Your YAML content here...
```

#### Shell Scripts (.sh)

```bash
#!/usr/bin/env bash

# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Your script here...
```

### Checking License Headers

Before committing, run the license header check:

```bash
./check-headers.sh
```

This script will identify any files missing the required license header. The script automatically excludes:

- `node_modules/`
- `.angular/`
- `dist/`
- Other generated/cached files

### Automated Checks

- **Pre-commit Hook**: The license header check runs automatically before each commit
- **CI Pipeline**: GitHub Actions will verify all files have proper headers on every pull request

## Code Style

### General Guidelines

- Follow the existing code style in the project
- Use TypeScript for all new code
- Follow Angular style guide for Angular components
- Use meaningful variable and function names
- Add comments for complex logic

### Linting

The project uses ESLint and Prettier for code formatting. Run linting before committing:

```bash
# Run linting for all packages
yarn lint

# Run linting with auto-fix
yarn lint:fix

# Run formatting
yarn format
```

## Architecture Guidelines

### Respect Existing Architecture

Before making changes that affect how the application works at a foundational
level, understand the decisions already in place. The project has established
patterns for SSR, authentication, component structure, logging, and forms — all
documented in [CLAUDE.md](CLAUDE.md) and the [architecture docs](docs/). Changes
that deviate from these patterns need discussion and approval before
implementation.

### Fixing Problems at the Source

When something doesn't work — a hydration crash, an auth issue, a build
problem — fix the root cause rather than disabling the system that surfaced
it. Disabling SSR, bypassing authentication, or adding build hacks are not
fixes. They mask the real issue and introduce regressions that affect the entire
application.

### Security Is Not Optional

Authentication and authorization controls exist to protect the application and
its users. These controls should be addressed, not disabled for convenience.
If your local environment needs credentials, request them or set up the
environment properly. `TODO: TEMPORARY` bypasses have a tendency to reach
production.

### Architectural Changes Need Their Own PRs

Changes that affect the entire application — auth middleware, SSR configuration,
global interceptors, new development tooling patterns, mock infrastructure — are
architectural decisions. They need standalone PRs with focused review and
approval, not bundled inside feature work where they can be overlooked.

### Follow Established Patterns

The codebase has consistent patterns for how things are built. New code should
follow the same patterns used by existing code. Before starting work, review the
relevant documentation:

- [Angular Patterns](docs/architecture/frontend/angular-patterns.md) — SSR,
  zoneless change detection, signals
- [Component Architecture](docs/architecture/frontend/component-architecture.md)
  — PrimeNG wrappers, layout patterns, component hierarchy
- [Authentication](docs/architecture/backend/authentication.md) — Auth0
  middleware and route protection
- [Logging & Monitoring](docs/architecture/backend/logging-monitoring.md) —
  Structured logging patterns
- [Shared Package](docs/architecture/shared/package-architecture.md) — Types,
  constants, validators, and utilities

See [CLAUDE.md](CLAUDE.md) for the complete reference on project patterns and
conventions, and the [Architecture Navigation Hub](docs/architecture/README.md)
for the full documentation index.

## Commit Messages

### Format

Follow the conventional commit format:

```text
type(scope): subject

body

footer
```

### Types

Commitlint uses `@commitlint/config-angular`. Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`. `chore` is **not** accepted — use the closest specific type (`build`, `ci`, `docs`, `refactor`, etc.) instead.

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `build`: Build system or dependency changes
- `ci`: CI configuration changes
- `revert`: Reverts a previous commit

### Examples

```text
feat(auth): add Auth0 integration

Implemented Auth0 authentication using express-openid-connect
middleware with proper token refresh handling.

Closes #123
```

### Sign-off

All commits must be signed off:

```bash
git commit --signoff
```

This adds a `Signed-off-by` line to your commit message.

## Pull Request Process

### PR Scope

- **Keep PRs focused on a single concern** — a feature PR should contain only
  the feature. Infrastructure changes (mock servers, new interceptors, build
  tool changes) must be separate PRs
- **Architectural decisions require their own PR** — changes that affect the
  entire application (auth middleware, SSR config, global interceptors, new dev
  tooling patterns) need standalone discussion and approval before
  implementation
- **Never mix security changes with feature work** — auth middleware or guard
  modifications must be reviewed independently, not buried in a large feature PR

### PR Checklist

1. **Update Documentation**: Update relevant documentation for any new features
2. **Add Tests**: Include tests for new functionality
3. **Pass All Checks**: Ensure all tests and linting pass
4. **License Headers**: Verify all new files have proper license headers
5. **Clear Description**: Provide a clear description of changes in the PR
6. **Link Issues**: Reference any related issues
7. **Deploy Preview**: (Optional) Deploy and preview the feature or
   change in a hosted environment

### PR Title Format

Use the same conventional commit format for PR titles:

```text
feat(component): add new table component
```

## Testing

### Running Tests

```bash
# Run unit tests (Karma)
yarn test

# Playwright E2E suite
yarn e2e             # headless, all browsers
yarn e2e:ui          # Playwright UI mode
yarn e2e:headed      # visible browser
```

### Test Requirements

- All new features must include unit tests
- Maintain or improve code coverage
- E2E tests for critical user flows

### Deploy Preview

Contributors with write access to the repository have the option to add
the **deploy-preview** label to their pull request. Adding this label will
deploy the pull request to a hosted Kubernetes development cluster in an
isolated namespace. A link to the hosted deployment will be added as a
comment to the pull request.

When the pull request is closed or the **deploy-preview** label is
removed, the deployment will be removed.

## Questions?

If you have questions about contributing, please:

1. Check existing issues and discussions
2. Open a new issue for clarification
3. Join our community channels

Thank you for contributing to LFX One!

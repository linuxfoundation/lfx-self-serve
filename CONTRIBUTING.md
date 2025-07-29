# Contributing to LFX Projects Self-Service

Contributions are what make the open-source community such an amazing place to learn, inspire, and create.

Thank you for your interest in contributing to LFX PCC! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [License Headers](#license-headers)
- [Code Style](#code-style)
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

## Commit Messages

### Format

Follow the conventional commit format:

```text
type(scope): subject

body

footer
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

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

1. **Update Documentation**: Update relevant documentation for any new features
2. **Add Tests**: Include tests for new functionality
3. **Pass All Checks**: Ensure all tests and linting pass
4. **License Headers**: Verify all new files have proper license headers
5. **Clear Description**: Provide a clear description of changes in the PR
6. **Link Issues**: Reference any related issues

### PR Title Format

Use the same conventional commit format for PR titles:

```text
feat(component): add new table component
```

## Testing

### Running Tests

```bash
# Run all tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run e2e tests
yarn e2e
```

### Test Requirements

- All new features must include unit tests
- Maintain or improve code coverage
- E2E tests for critical user flows

## Questions?

If you have questions about contributing, please:

1. Check existing issues and discussions
2. Open a new issue for clarification
3. Join our community channels

Thank you for contributing to LFX PCC!

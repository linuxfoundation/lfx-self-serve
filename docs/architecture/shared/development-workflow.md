# Development Workflow

## 🔄 Turborepo Configuration

The monorepo uses Turborepo for efficient task orchestration and caching across packages and applications.

## 🏗 Turborepo Task Pipeline

### Core Configuration

```json
// turbo.json
{
  "$schema": "https://turborepo.com/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "check-types": {
      "dependsOn": ["^build"]
    },
    "start": {
      "cache": false,
      "persistent": true
    },
    "watch": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"]
    }
  }
}
```

### Task Dependencies

- **Build Pipeline**: Shared packages build before applications
- **Type Checking**: Depends on built packages for type resolution
- **Testing**: Requires built dependencies
- **Linting**: Runs independently with dependency chain

## 📦 Workspace Structure

### Yarn Workspaces

```json
// package.json
{
  "workspaces": ["apps/*", "packages/*"],
  "packageManager": "yarn@4.6.0"
}
```

### Current Workspaces

```text
lfx-one/
├── apps/
│   └── lfx-one/              # Angular application
└── packages/
    └── shared/               # Shared interfaces and constants
```

## 🛠 Development Commands

### Root-Level Commands

```bash
# Build all packages and applications
yarn build

# Start development servers
yarn start

# Run linting across all workspaces
yarn lint

# Run tests across all workspaces
yarn test

# Type checking across all workspaces
yarn check-types

# Watch mode for development
yarn watch

# Format code with Prettier
yarn format
```

### Production Commands

```bash
# Start production server with PM2
yarn start:prod

# Stop production server
yarn stop:prod

# Restart production server
yarn restart:prod

# Zero-downtime reload
yarn reload:prod

# View production logs
yarn logs:prod
```

## 🔄 Development Workflow

### Typical Development Flow

1. **Install Dependencies**

   ```bash
   yarn install
   ```

2. **Build Shared Packages**

   ```bash
   cd packages/shared
   yarn build
   ```

3. **Start Development Server**

   ```bash
   yarn start
   ```

4. **Make Changes and Test**

   ```bash
   # In separate terminal
   ./check-headers.sh  # Verify license headers
   yarn lint
   yarn check-types
   ```

### Shared Package Development

When working on shared packages:

```bash
# Navigate to shared package
cd packages/shared

# Watch for changes and rebuild
yarn watch

# In another terminal, start the app
cd ../../
yarn start
```

## 🎯 Task Execution Strategy

### Parallel Execution

Turborepo runs tasks in parallel when possible:

```bash
# These run in parallel across workspaces
yarn lint    # Lints all packages simultaneously
yarn test    # Tests all packages simultaneously
```

### Dependency-Based Execution

```bash
# These respect dependency order
yarn build          # Builds shared packages first, then apps
yarn check-types    # Type checks after dependencies are built
```

## 📊 Caching Strategy

### Build Caching

```json
{
  "build": {
    "outputs": ["dist/**"], // Cache build outputs
    "inputs": ["$TURBO_DEFAULT$", ".env*"] // Invalidate on file changes
  }
}
```

### Cache Benefits

- **Faster Builds**: Skip unchanged packages
- **CI/CD Optimization**: Share cache across environments
- **Development Speed**: Incremental builds

### Non-Cached Tasks

```json
{
  "start": {
    "cache": false, // Development server shouldn't be cached
    "persistent": true // Long-running process
  }
}
```

## 🔧 TypeScript Configuration

### Shared TypeScript Config

Projects inherit from shared configuration:

```json
// packages/shared/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist"
  }
}
```

### Application TypeScript Config

```json
// apps/lfx-one/tsconfig.json
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "paths": {
      "@lfx-one/shared": ["../../packages/shared/src/index.ts"],
      "@lfx-one/shared/*": ["../../packages/shared/src/*"]
    }
  }
}
```

## 📋 Dependency Management

### Package Dependencies

```json
// Root package.json
{
  "devDependencies": {
    "prettier": "^3.6.2",
    "turbo": "^2.5.4",
    "typescript": "5.8.3"
  },
  "engines": {
    "node": ">=18"
  }
}
```

### Workspace Dependencies

```json
// apps/lfx-one/package.json
{
  "dependencies": {
    "@lfx-one/shared": "workspace:*"
  }
}
```

## 🔄 Version Management

### Workspace Versioning

- **Independent Versioning**: Each package has its own version
- **Workspace Protocol**: Use `workspace:*` for local dependencies
- **Semantic Versioning**: Follow semver for all packages

### Release Process

1. Update package versions
2. Build all packages
3. Run tests
4. Commit and tag
5. Deploy applications

## 🔐 Code Quality and Compliance

### License Header Requirements

All source code files must include the appropriate license header:

```bash
# Check license headers
./check-headers.sh
```

**Required Format:**

```typescript
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
```

### Pre-commit Hooks

The repository uses Husky for pre-commit hooks that automatically run:

1. **License Header Check** - Ensures all files have proper headers
2. **Linting** - Runs ESLint and Prettier
3. **Type Checking** - Verifies TypeScript types
4. **Format Check** - Ensures consistent code formatting

```bash
# Pre-commit hooks run automatically on commit
git commit -m "your changes"

# To bypass pre-commit hooks (not recommended)
git commit -m "your changes" --no-verify
```

### CI/CD Integration

- **License Header Check**: Automated workflow validates headers on PRs
- **Quality Checks**: Separate workflow for linting, testing, and building
- **Automated Enforcement**: PRs cannot be merged without passing all checks

## 🎯 Best Practices

### Development Guidelines

1. **License Headers**: Ensure all new files have proper license headers
2. **Shared Package First**: Build shared packages before applications
3. **Type Safety**: Always run type checking before commits
4. **Linting**: Maintain consistent code style
5. **Testing**: Run tests in affected packages
6. **Incremental Builds**: Leverage Turborepo caching

### Performance Optimization

```bash
# Run only affected packages (future feature)
yarn build --filter=...HEAD^

# Parallel execution
yarn build --parallel

# Remote caching (in CI/CD)
yarn build --remote-cache
```

## 🔧 Troubleshooting

### Common Issues

```bash
# Clear Turborepo cache
npx turbo prune

# Reinstall dependencies
rm -rf node_modules packages/*/node_modules apps/*/node_modules
yarn install

# Force rebuild shared packages
cd packages/shared
rm -rf dist
yarn build
```

### Build Issues

```bash
# Check dependency graph
npx turbo build --graph

# Verbose build output
npx turbo build --verbose

# Build specific package
npx turbo build --filter=@lfx-one/shared
```

## 📈 Monitoring and Analytics

### Task Performance

Turborepo provides insights into task performance:

```bash
# Task timing information
yarn build --profile

# Task dependency visualization
yarn build --graph
```

### Cache Hit Rates

Monitor cache effectiveness:

- High cache hit rates indicate efficient incremental builds
- Low cache hit rates suggest configuration issues

## 🔄 Current Workflow Status

### ✅ Implemented Features

- Turborepo task orchestration
- Yarn 4 workspace management
- TypeScript path mapping
- Build dependency management
- Parallel task execution
- Basic caching strategy

### 🔲 Future Enhancements

- Remote caching configuration
- Affected package detection
- Advanced dependency filtering
- CI/CD pipeline integration
- Performance monitoring
- Automated release management

This development workflow provides efficient monorepo management with fast builds and reliable dependency handling.

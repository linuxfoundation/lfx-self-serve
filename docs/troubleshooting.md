# Troubleshooting Guide

## 🚀 Quick Fixes

### Development Server Issues

If the development server won't start:

```bash
# Clear Angular cache
ng cache clean

# Reinstall dependencies
rm -rf node_modules yarn.lock
yarn install

# Start development server
yarn start
```

## 🔧 Common Issues

### Angular 19 Zoneless Issues

#### Component Not Updating

```typescript
// Issue: Component not re-rendering with zoneless change detection
// Solution: Ensure you're using Angular Signals

// ❌ Wrong - RxJS Observable without proper change detection
export class Component {
  data$ = this.service.getData();
}

// ✅ Right - Angular Signals
export class Component {
  private readonly service = inject(DataService);
  protected readonly data = this.service.data; // Signal from service
}
```

#### Manual Change Detection

```typescript
// If you need manual change detection
import { ChangeDetectorRef, inject } from '@angular/core';

export class Component {
  private readonly cdr = inject(ChangeDetectorRef);

  onThirdPartyCallback() {
    // Trigger change detection manually if needed
    this.cdr.markForCheck();
  }
}
```

### PrimeNG Integration Issues

#### CSS Layer Conflicts

```scss
// Issue: Tailwind utilities not overriding PrimeNG styles
// Solution: Verify CSS layer order in styles.scss

@layer tailwind-base, primeng, tailwind-utilities;

@layer tailwind-base {
  @tailwind base;
}

@layer tailwind-utilities {
  @tailwind components;
  @tailwind utilities;
}
```

#### Theme Configuration Problems

```typescript
// Issue: PrimeNG components not using LFX theme
// Solution: Check app.config.ts theme configuration

providePrimeNG({
  theme: {
    preset: customPreset, // Ensure LFX preset is imported
    options: {
      prefix: 'p',
      darkModeSelector: '.dark-mode',
      cssLayer: {
        name: 'primeng',
        order: 'tailwind-base, primeng, tailwind-utilities',
      },
    },
  },
});
```

### SSR Server Issues

#### Server Won't Start

```bash
# Check build output exists
ls -la apps/lfx-one/dist/lfx-one/

# Verify server file exists
ls -la apps/lfx-one/dist/lfx-one/server/server.mjs

# Check for build errors
yarn build
```

#### Express Server Errors

```bash
# Check server logs
yarn serve:ssr

# Test health endpoint
curl http://localhost:4200/health

# Check environment variables
echo $NODE_ENV
echo $PORT
```

### Authentication Issues

#### Auth0 Configuration Problems

```bash
# Verify Auth0 environment variables
echo $PCC_AUTH0_CLIENT_ID
echo $PCC_AUTH0_CLIENT_SECRET
echo $PCC_AUTH0_ISSUER_BASE_URL
echo $PCC_AUTH0_AUDIENCE

# Test authentication endpoint
curl -I http://localhost:4200/login
```

#### Session Issues

```bash
# Clear browser storage
# 1. Open DevTools (F12)
# 2. Application tab → Storage
# 3. Clear cookies and localStorage

# Check Auth0 session
# Visit: http://localhost:4200/api/auth/me
```

### Build Issues

#### TypeScript Errors

```bash
# Run TypeScript compiler directly
npx tsc --noEmit

# Check for missing types
yarn add -D @types/node

# Verify path mappings
cat tsconfig.json | grep -A 10 "paths"
```

#### Turborepo Cache Issues

```bash
# Clear Turborepo cache
npx turbo clean

# Force rebuild without cache
yarn build --force

# Check turbo configuration
cat turbo.json
```

### Environment Issues

#### Node.js Version Problems

```bash
# Check Node.js version (requires 22+)
node --version

# Use correct Node.js version with nvm
nvm use 22
```

#### Yarn Version Issues

```bash
# Check Yarn version (requires 4.9.2+)
yarn --version

# Enable Corepack if needed
corepack enable

# Update Yarn if necessary
corepack prepare yarn@4.9.2 --activate
```

### Development Issues

#### Hot Reload Not Working

```bash
# Restart development server
yarn start

# Check file watchers (Linux/WSL)
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Clear Angular cache
ng cache clean
```

#### Import Path Issues

```typescript
// Issue: Import paths not resolving
// Solution: Use configured path mappings

// ❌ Wrong - relative imports
import { Component } from '../../shared/components/component';

// ✅ Right - path mapping
import { Component } from '@lfx-one/shared/components';
```

### Testing Issues

#### Playwright Test Failures

```bash
# Install browsers
npx playwright install

# Run tests in headed mode for debugging
yarn e2e --headed

# Run specific test file
yarn e2e homepage.spec.ts

# Generate test report
yarn e2e --reporter=html
```

#### Authentication in Tests

```bash
# Check test authentication setup
cat apps/lfx-one/e2e/helpers/global-setup.ts

# Verify test credentials
echo $TEST_USERNAME
echo $TEST_PASSWORD
```

### Production Issues

#### PM2 Deployment Problems

```bash
# Check PM2 status
pm2 status

# View application logs
pm2 logs lfx-one

# Restart application
pm2 restart lfx-one

# Check ecosystem configuration
cat ecosystem.config.js
```

#### Memory Issues

```bash
# Monitor memory usage
pm2 monit

# Check for memory leaks
pm2 show lfx-one

# Restart if memory limit exceeded
pm2 restart lfx-one
```

## 📊 Diagnostic Commands

### Health Checks

```bash
# Application health
curl http://localhost:4200/health

# Check Angular build
yarn build

# Verify dependencies
yarn install --check-files

# Test SSR rendering
yarn serve:ssr
curl http://localhost:4200/
```

### Performance Analysis

```bash
# Bundle analysis
yarn build --analyze

# Lighthouse audit
npx lighthouse http://localhost:4200 --chrome-flags="--headless"

# Memory profiling
node --inspect apps/lfx-one/dist/lfx-one/server/server.mjs
```

## 🔍 Debugging Strategies

### Angular Signals Debugging

```typescript
// Add effects to debug signal changes
import { effect } from '@angular/core';

export class Component {
  constructor() {
    effect(() => {
      console.log('Data changed:', this.data());
    });
  }
}
```

### Browser DevTools

1. **Network Tab**: Check API calls and responses
2. **Console Tab**: Look for JavaScript errors
3. **Application Tab**: Inspect localStorage and cookies
4. **Sources Tab**: Set breakpoints in TypeScript code

### Server-Side Debugging

```bash
# Enable debug mode
DEBUG=* yarn serve:ssr

# Node.js inspector
node --inspect-brk apps/lfx-one/dist/lfx-one/server/server.mjs

# PM2 debug mode
pm2 start ecosystem.config.js --debug
```

## 📝 Log Analysis

### Client-Side Logs

- **Browser Console**: Press F12, Console tab
- **Network Errors**: F12, Network tab, filter by errors
- **Service Worker**: F12, Application tab, Service Workers

### Server-Side Logs

```bash
# Development server logs
yarn start # Check terminal output

# Production PM2 logs
pm2 logs lfx-one

# System logs (Linux)
journalctl -u nodejs-app

# Docker logs (if containerized)
docker logs container-name
```

## 🚨 Emergency Procedures

### Complete Environment Reset

```bash
# 1. Stop all processes
pm2 stop all

# 2. Clear all caches
ng cache clean
npx turbo clean
rm -rf node_modules yarn.lock

# 3. Reinstall dependencies
yarn install

# 4. Rebuild application
yarn build

# 5. Restart services
yarn start
```

### Database Connection Issues (if applicable)

```bash
# Check microservice connectivity
curl -I $LFX_V2_SERVICE/health

# Test NATS connection
# Check NATS_URL environment variable
echo $NATS_URL

# Verify network connectivity
ping your-microservice-host
```

## 📚 Getting Help

### Documentation Links

- **[Architecture Guide](./architecture.md)** - System overview
- **[Development Setup](../CLAUDE.md)** - Development environment
- **[E2E Testing Guide](./architecture/testing/e2e-testing.md)** - Testing procedures

### Support Channels

- **JIRA Project**: LFXV2 - Create tickets for bugs and issues
- **Architecture Questions**: Refer to architecture documentation
- **Environment Issues**: Check environment configuration guide

---

_This troubleshooting guide is specific to LFX One. For questions or additional issues, create a JIRA ticket using project key LFXV2._

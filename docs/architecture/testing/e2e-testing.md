# End-to-End Testing Architecture

## 🏗 Overview

Our E2E testing strategy employs a **dual architecture approach** combining content-based and structural tests to ensure comprehensive, maintainable, and reliable test coverage across the LFX One application.

## 🎯 Dual Testing Architecture

### Content-Based Tests (Original)

- **Purpose**: Validate user experience and visible content
- **Target**: Text content, user interactions, workflows
- **Best For**: Acceptance testing, user journey validation
- **Examples**: `homepage.spec.ts`, `project-dashboard.spec.ts`

### Structural Tests (Robust)

- **Purpose**: Validate component architecture and framework integration
- **Target**: Component structure, Angular signals, data attributes
- **Best For**: Technical validation, UI library independence
- **Examples**: `homepage-robust.spec.ts`, `project-dashboard-robust.spec.ts`

## 📊 Current Test Coverage

```text
Total E2E Tests: 85+ (All Passing)
├── Homepage Tests: 33 tests
│   ├── homepage.spec.ts: 11 content-based tests
│   └── homepage-robust.spec.ts: 22 structural tests
└── Project Dashboard Tests: 52 tests
    ├── project-dashboard.spec.ts: 29 content-based tests
    └── project-dashboard-robust.spec.ts: 23 structural tests
```

## 🛠 Technical Stack

### Primary Framework: Playwright

- **Cross-browser support**: Chromium, Firefox, Mobile Chrome
- **Modern async/await API** with built-in waiting strategies
- **Parallel execution** with worker configuration
- **Authentication state management** with global setup

### Browser Configuration

```typescript
// playwright.config.ts - Mobile Chrome Configuration
{
  name: 'mobile-chrome',
  use: {
    ...devices['Pixel 5'],
    storageState: 'playwright/.auth/user.json',
  },
  // Single worker to prevent resource contention
  workers: 1,
}
```

## 🔧 Data-TestID Architecture

### Implementation Strategy

#### 1. Component-Level Attributes

```html
<!-- Homepage Hero Section -->
<div data-testid="hero-section">
  <h1 data-testid="hero-title">...</h1>
  <p data-testid="hero-subtitle">...</p>
  <div data-testid="hero-search-container">
    <lfx-input-text data-testid="hero-search-input">
  </div>
</div>
```

#### 2. Dynamic Attributes for State

```html
<!-- Project Cards with Dynamic Identification -->
<lfx-project-card data-testid="project-card" [attr.data-project-slug]="project.slug"> </lfx-project-card>
```

#### 3. Nested Component Structure

```html
<!-- Project Metrics with Hierarchical Testing -->
<div data-testid="project-metrics">
  <div data-testid="project-metric" [attr.data-metric-label]="metric.label">
    <div data-testid="metric-label-container">
      <i data-testid="metric-icon"></i>
      <span data-testid="metric-label">{{ metric.label }}</span>
    </div>
    <div data-testid="metric-value-container">
      <span data-testid="metric-value">{{ metric.value }}</span>
    </div>
  </div>
</div>
```

### Naming Conventions

1. **Section-level**: `data-testid="hero-section"`
2. **Component-level**: `data-testid="project-card"`
3. **Element-level**: `data-testid="project-title"`
4. **Container-level**: `data-testid="metrics-cards-container"`
5. **Dynamic identification**: `[attr.data-project-slug]="project.slug"`

## 🧪 Test Patterns and Examples

### 1. Structural Component Validation

```typescript
test('should use lfx-card components consistently', async ({ page }) => {
  const testCards = [
    page.locator('[data-testid="total-members-card"]'),
    page.locator('[data-testid="project-health-card"]'),
    page.locator('[data-testid="quick-actions-card"]'),
  ];

  for (const card of testCards) {
    await expect(card).toBeVisible();
    // Validate component architecture
    const tagName = await card.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe('lfx-card');
  }
});
```

### 2. Angular Signals Integration Testing

```typescript
test('should properly integrate Angular signals and computed values', async ({ page }) => {
  // Wait for Angular to initialize and signals to resolve
  await page.waitForLoadState('networkidle');

  // Check that percentage values are rendered (indicates successful signal integration)
  const activityScore = page.locator('[data-testid="activity-score-indicator"] span').filter({ hasText: /%$/ });
  await expect(activityScore).toBeVisible();

  const meetingCompletion = page.locator('[data-testid="meeting-completion-indicator"] span').filter({ hasText: /%$/ });
  await expect(meetingCompletion).toBeVisible();
});
```

### 3. Responsive Design Testing

```typescript
test('should display header elements correctly for current viewport', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Go to home page' })).toBeVisible();
  await expect(page.getByAltText('LFX Logo')).toBeVisible();

  // Viewport-aware assertions
  const viewport = page.viewportSize();
  const isMobile = viewport && viewport.width < 768;

  if (isMobile) {
    // Mobile: search and brand text should be hidden
    await expect(page.getByPlaceholder('Search projects...')).toBeHidden();
    await expect(page.getByText('Projects Self-Service')).toBeHidden();
  } else {
    // Desktop: search and brand text should be visible
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible();
    await expect(page.getByText('Projects Self-Service')).toBeVisible();
  }
});
```

### 4. Content-Based User Journey Testing

```typescript
test('should navigate to project detail when clicking a project card', async ({ page }) => {
  // Wait for project cards to load
  await page.waitForLoadState('networkidle');

  const firstCard = page.locator('lfx-project-card').first();
  await expect(firstCard).toBeVisible();

  // Get project name for verification
  const projectName = await firstCard.getByRole('heading', { level: 3 }).innerText();

  // Click the card
  await firstCard.click();

  // Verify navigation
  await expect(page).toHaveURL(/\/project\/[\w-]+$/);
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: projectName })).toBeVisible();
});
```

## 📱 Multi-Browser Testing Strategy

### Browser-Specific Configurations

#### Chromium (Desktop)

- Full feature testing
- Parallel execution (5 workers)
- Complete test suite

#### Mobile Chrome

- Single worker configuration (prevents resource contention)
- Mobile-specific responsive validation
- Touch interaction testing

#### Firefox

- Cross-browser compatibility validation
- Engine-specific behavior testing

### Viewport Testing Strategy

```typescript
// Mobile Viewport (< 768px)
test('should display correctly on mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  // Mobile-specific expectations
  await expect(page.getByPlaceholder('Search projects...')).toBeHidden();
  await expect(page.getByText('Projects Self-Service')).toBeHidden();
  await expect(page.getByAltText('LFX Logo')).toBeVisible();
});

// Tablet Viewport (≥ 768px)
test('should display correctly on tablet viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });

  // Tablet-specific expectations
  await expect(page.getByPlaceholder('Search projects...')).toBeVisible();
  await expect(page.getByText('Projects Self-Service')).toBeVisible();
});
```

## 🔐 Authentication Architecture

### Global Setup Strategy

```typescript
// e2e/helpers/global-setup.ts
async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to logout to trigger authentication flow
    await page.goto(`${url}/logout`);

    // Perform authentication
    await AuthHelper.loginWithAuth0(page, TEST_CREDENTIALS);

    // Save authentication state
    await context.storageState({ path: 'playwright/.auth/user.json' });
  } finally {
    await browser.close();
  }
}
```

### Auth Helper Pattern

```typescript
// e2e/helpers/auth.helper.ts
export class AuthHelper {
  static async loginWithAuth0(page: Page, credentials: TestCredentials) {
    // Wait for Auth0 login page
    await page.waitForSelector('[data-testid="auth0-login-form"]');

    // Fill credentials
    await page.fill('input[name="username"]', credentials.username);
    await page.fill('input[name="password"]', credentials.password);

    // Submit and wait for redirect
    await page.click('button[type="submit"]');
    await page.waitForURL(/localhost:4200/);
  }
}
```

## 🚀 Best Practices

### 1. Element Selection Strategy

#### ✅ Recommended: Data-TestID

```typescript
await expect(page.locator('[data-testid="project-card"]')).toBeVisible();
```

#### ✅ Acceptable: Semantic Selectors

```typescript
await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
```

#### ❌ Avoid: CSS Classes (Tailwind)

```typescript
// Brittle - classes can change
await expect(page.locator('.bg-blue-500.text-white')).toBeVisible();
```

#### ❌ Avoid: Generic Text Selectors

```typescript
// Unreliable - text can change
await expect(page.getByText('Submit')).toBeVisible();
```

### 2. Waiting Strategies

#### Built-in Waiting (Preferred)

```typescript
await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible();
await expect(page.locator('[data-testid="content"]')).toBeVisible();
```

#### Network Idle for Dynamic Content

```typescript
await page.waitForLoadState('networkidle');
const projectCards = page.locator('[data-testid="project-card"]');
```

### 3. Test Organization

#### Descriptive Test Groups

```typescript
test.describe('Homepage - Robust Tests', () => {
  test.describe('Page Structure and Components', () => {
    test('should have correct page structure with main sections', async ({ page }) => {
      // Component architecture validation
    });
  });

  test.describe('Component Integration', () => {
    test('should properly integrate Angular signals and computed values', async ({ page }) => {
      // Framework-specific validation
    });
  });
});
```

### 4. Error Handling and Debugging

#### Conditional Assertions

```typescript
const hasProjects = await page
  .locator('[data-testid="projects-grid"]')
  .isVisible()
  .catch(() => false);
const hasSkeleton = await page
  .locator('[data-testid="projects-skeleton"]')
  .isVisible()
  .catch(() => false);

expect(hasProjects || hasSkeleton).toBe(true);
```

#### Clear Error Messages

```typescript
const cardCount = await projectCards.count();
expect(cardCount).toBeGreaterThan(0, 'Should have at least one project card');
```

## 📊 Maintenance and Monitoring

### Test Health Metrics

#### Current Status: ✅ 85/85 tests passing

1. **Reliability**: Zero flaky tests
2. **Performance**: Average test suite runs in ~54 seconds (Chromium)
3. **Coverage**: All major user journeys covered
4. **Maintainability**: Data-testid architecture prevents UI change breakage

### Test Maintenance Schedule

**Weekly**: Run full test suite across all browsers
**Per PR**: Automated test execution in CI/CD
**Monthly**: Review and update test documentation
**Quarterly**: Evaluate new testing patterns and tools

### Debugging Guidelines

1. **Screenshot Analysis**: Use Playwright's built-in screenshot capture
2. **Trace Files**: Leverage trace viewer for step-by-step debugging
3. **Network Analysis**: Monitor API calls and responses
4. **Console Logs**: Check for JavaScript errors
5. **Element Inspection**: Validate data-testid attributes in dev tools

## 🔄 Implementation Checklist

### ✅ Completed

- [x] Dual testing architecture (content + structural)
- [x] Data-testid implementation across components
- [x] Multi-browser configuration (Chromium, Mobile Chrome)
- [x] Responsive design testing
- [x] Authentication flow with global setup
- [x] Angular signals integration testing
- [x] Component architecture validation

### 🔲 Future Enhancements

- [ ] Visual regression testing with screenshot comparison
- [ ] Accessibility testing with axe-core integration
- [ ] Performance testing with Core Web Vitals
- [ ] Cross-platform testing (Windows, macOS, Linux)
- [ ] Test reporting dashboard with historical data

## 🎯 Testing Guidelines for New Features

When adding new features, follow this testing approach:

### 1. Add Data-TestID Attributes

```html
<!-- New feature component -->
<div data-testid="feature-container">
  <lfx-new-component data-testid="feature-component">
    <div data-testid="feature-content">
      <!-- Feature content -->
    </div>
  </lfx-new-component>
</div>
```

### 2. Create Both Test Types

#### Content-Based Test (User Experience)

```typescript
test('should allow user to complete new feature workflow', async ({ page }) => {
  // Test user-visible behavior and interactions
});
```

#### Structural Test (Technical Implementation)

```typescript
test('should use correct component architecture for new feature', async ({ page }) => {
  // Test component structure and framework integration
});
```

### 3. Include Responsive Testing

```typescript
test('should display new feature correctly across viewports', async ({ page }) => {
  // Test mobile, tablet, and desktop layouts
});
```

This comprehensive E2E testing architecture ensures reliable, maintainable tests that provide confidence in both user experience and technical implementation while surviving UI changes and framework updates.

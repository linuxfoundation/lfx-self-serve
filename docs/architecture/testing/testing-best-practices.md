# Testing Best Practices Guide

## 🎯 Overview

This guide outlines testing best practices for the LFX Projects Self-Service application, covering our dual testing architecture, data-testid conventions, and implementation guidelines.

## 🏗 Dual Testing Architecture Principles

### When to Use Content-Based Tests

**Purpose**: Validate user experience and acceptance criteria

**Use Cases**:

- User journey testing (login → search → navigate → interact)
- Content validation (text, labels, messages)
- Accessibility testing (screen reader compatibility)
- Cross-browser functionality testing

**Example**:

```typescript
test('should complete project search workflow', async ({ page }) => {
  // User sees and interacts with visible elements
  await expect(page.getByRole('textbox', { name: 'Search projects' })).toBeVisible();
  await page.fill('input[placeholder*="Search"]', 'kubernetes');
  await expect(page.getByText('Kubernetes')).toBeVisible();
});
```

### When to Use Structural Tests

**Purpose**: Validate technical implementation and component architecture

**Use Cases**:

- Component integration testing (Angular signals, computed values)
- Framework-specific validation (custom components, directives)
- UI library independence (ensuring wrapper components work)
- Architecture compliance (consistent component usage)

**Example**:

```typescript
test('should use lfx-card components consistently', async ({ page }) => {
  // Technical validation of component architecture
  const cards = page.locator('[data-testid="project-card"]');
  const firstCard = cards.first();

  const tagName = await firstCard.evaluate((el) => el.tagName.toLowerCase());
  expect(tagName).toBe('lfx-project-card');
});
```

## 🔧 Data-TestID Implementation Guide

### Naming Conventions

**Hierarchical Structure**:

```
[section]-[component]-[element]
hero-search-input
metrics-cards-container
project-health-card
```

**Category Guidelines**:

1. **Sections**: `hero-section`, `projects-section`, `footer-section`
2. **Containers**: `metrics-cards-container`, `projects-grid`, `navigation-menu`
3. **Components**: `project-card`, `search-input`, `user-avatar`
4. **Elements**: `project-title`, `metric-value`, `loading-spinner`
5. **Actions**: `submit-button`, `cancel-link`, `edit-icon`

### Implementation Examples

**Basic Component**:

```html
<lfx-card data-testid="project-health-card">
  <div data-testid="health-indicators-container">
    <div data-testid="activity-score-indicator">
      <span data-testid="activity-score-value">85%</span>
      <span data-testid="activity-score-label">Activity Score</span>
    </div>
  </div>
</lfx-card>
```

**Dynamic Attributes**:

```html
<lfx-project-card data-testid="project-card" [attr.data-project-slug]="project.slug" [attr.data-project-status]="project.status"> </lfx-project-card>
```

**Lists and Collections**:

```html
<div data-testid="project-metrics">
  @for (metric of metrics; track metric.id) {
  <div data-testid="project-metric" [attr.data-metric-type]="metric.type">
    <span data-testid="metric-label">{{ metric.label }}</span>
    <span data-testid="metric-value">{{ metric.value }}</span>
  </div>
  }
</div>
```

## 📱 Responsive Testing Strategy

### Viewport Breakpoints

**Mobile**: `< 768px` (iPhone, Android)
**Tablet**: `768px - 1024px` (iPad, tablets)
**Desktop**: `> 1024px` (laptops, monitors)

### Implementation Pattern

```typescript
test('should adapt to viewport size', async ({ page }) => {
  const viewport = page.viewportSize();
  const isMobile = viewport && viewport.width < 768;
  const isTablet = viewport && viewport.width >= 768 && viewport.width < 1024;
  const isDesktop = viewport && viewport.width >= 1024;

  if (isMobile) {
    // Mobile-specific expectations
    await expect(page.getByPlaceholder('Search projects...')).toBeHidden();
    await expect(page.locator('[data-testid="mobile-menu-button"]')).toBeVisible();
  } else if (isTablet) {
    // Tablet-specific expectations
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible();
    await expect(page.locator('[data-testid="desktop-navigation"]')).toBeVisible();
  } else {
    // Desktop-specific expectations
    await expect(page.locator('[data-testid="full-navigation"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  }
});
```

### Responsive Test Organization

```typescript
test.describe('Responsive Design', () => {
  test('should display correctly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    // Mobile tests
  });

  test('should display correctly on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    // Tablet tests
  });

  test('should display correctly on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    // Desktop tests
  });
});
```

## 🧪 Angular-Specific Testing Patterns

### Signals Integration Testing

```typescript
test('should properly integrate Angular signals', async ({ page }) => {
  // Wait for Angular to initialize and signals to resolve
  await page.waitForLoadState('networkidle');

  // Test computed signal results
  const metricsCards = page.locator('[data-testid="metrics-cards-container"]');
  await expect(metricsCards.locator('[data-testid="total-members-card"]')).toBeVisible();

  // Test signal reactivity (if search triggers signal updates)
  await page.fill('[data-testid="search-input"]', 'test');
  await page.waitForTimeout(300); // Debounce time

  // Verify signal-driven UI updates
  const filteredResults = page.locator('[data-testid="project-card"]');
  expect(await filteredResults.count()).toBeGreaterThanOrEqual(0);
});
```

### Component Architecture Validation

```typescript
test('should use custom LFX components consistently', async ({ page }) => {
  const componentsToValidate = [
    { selector: '[data-testid="hero-search-input"]', expected: 'lfx-input-text' },
    { selector: '[data-testid="project-card"]', expected: 'lfx-project-card' },
    { selector: '[data-testid="navigation-menu"]', expected: 'lfx-menu' },
  ];

  for (const { selector, expected } of componentsToValidate) {
    const element = page.locator(selector);
    await expect(element).toBeVisible();

    const tagName = await element.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe(expected);
  }
});
```

### Form Integration Testing

```typescript
test('should integrate Angular reactive forms', async ({ page }) => {
  const searchForm = page.locator('[data-testid="search-form"]');
  const searchInput = page.locator('[data-testid="search-input"]');

  // Test form validation
  await searchInput.fill('ab'); // Too short
  await expect(page.locator('[data-testid="search-error"]')).toBeVisible();

  // Test valid input
  await searchInput.fill('kubernetes');
  await expect(page.locator('[data-testid="search-error"]')).not.toBeVisible();

  // Test form submission
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="search-results"]')).toBeVisible();
});
```

## 🔍 Element Selection Best Practices

### Recommended Approaches (In Priority Order)

#### 1. Data-TestID (Highest Priority)

```typescript
// ✅ Most reliable - survives UI changes
await expect(page.locator('[data-testid="project-card"]')).toBeVisible();
```

#### 2. Semantic Role-Based

```typescript
// ✅ Good for accessibility and semantics
await expect(page.getByRole('button', { name: 'Save Project' })).toBeVisible();
await expect(page.getByRole('heading', { level: 1 })).toContainText('Dashboard');
```

#### 3. Label-Based

```typescript
// ✅ Good for form elements
await expect(page.getByLabel('Project Name')).toBeVisible();
await expect(page.getByPlaceholder('Enter project name')).toBeFocused();
```

#### 4. Text Content (Use Sparingly)

```typescript
// ⚠️ Use only for unique, stable text
await expect(page.getByText('No projects found')).toBeVisible();
```

### Approaches to Avoid

#### CSS Classes (Especially Tailwind)

```typescript
// ❌ Brittle - classes change frequently
await expect(page.locator('.bg-blue-500.text-white')).toBeVisible();
```

#### Complex CSS Selectors

```typescript
// ❌ Fragile - DOM structure can change
await expect(page.locator('div > div:nth-child(2) > span')).toBeVisible();
```

#### Generic Selectors

```typescript
// ❌ Non-specific - multiple matches possible
await expect(page.locator('button')).toBeVisible();
```

## ⏱ Waiting Strategies

### Built-in Waiting (Preferred)

```typescript
// ✅ Auto-waits until element is visible
await expect(page.locator('[data-testid="content"]')).toBeVisible();

// ✅ Auto-waits until element is clickable
await page.click('[data-testid="submit-button"]');

// ✅ Auto-waits until URL matches
await expect(page).toHaveURL(/\/project\/\w+/);
```

### Network-Based Waiting

```typescript
// ✅ Wait for network requests to complete
await page.waitForLoadState('networkidle');

// ✅ Wait for specific API responses
await page.waitForResponse((response) => response.url().includes('/api/projects') && response.status() === 200);
```

### Conditional Waiting

```typescript
// ✅ Handle optional elements gracefully
const loadingSpinner = page.locator('[data-testid="loading-spinner"]');
const isLoading = await loadingSpinner.isVisible().catch(() => false);

if (isLoading) {
  await expect(loadingSpinner).not.toBeVisible();
}

await expect(page.locator('[data-testid="content"]')).toBeVisible();
```

### Avoid Fixed Timeouts

```typescript
// ❌ Brittle and unreliable
await page.waitForTimeout(5000);

// ✅ Better - wait for specific condition
await expect(page.locator('[data-testid="data-loaded"]')).toBeVisible();
```

## 🔄 Test Organization Patterns

### Descriptive Test Structure

```typescript
test.describe('Feature Name - Test Type', () => {
  test.describe('Functional Area', () => {
    test('should perform specific action with expected outcome', async ({ page }) => {
      // Test implementation
    });
  });
});
```

**Example**:

```typescript
test.describe('Project Dashboard - Robust Tests', () => {
  test.describe('Metrics Cards', () => {
    test('should display all four metrics cards with proper structure', async ({ page }) => {
      // Structural validation
    });

    test('should display metrics with proper labels and values', async ({ page }) => {
      // Content validation
    });
  });

  test.describe('Component Integration', () => {
    test('should properly integrate Angular signals and computed values', async ({ page }) => {
      // Framework validation
    });
  });
});
```

### BeforeEach Patterns

```typescript
test.describe('Feature Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to page
    await page.goto('/feature');

    // Wait for initial load
    await expect(page.locator('[data-testid="main-content"]')).toBeVisible();

    // Setup test data if needed
    await page.route('/api/test-data', (route) => {
      route.fulfill({ json: mockData });
    });
  });

  // Tests...
});
```

## 🐛 Error Handling and Debugging

### Conditional Assertions

```typescript
test('should handle optional content gracefully', async ({ page }) => {
  // Check for either content or empty state
  const hasContent = await page
    .locator('[data-testid="content"]')
    .isVisible()
    .catch(() => false);
  const hasEmptyState = await page
    .locator('[data-testid="empty-state"]')
    .isVisible()
    .catch(() => false);

  expect(hasContent || hasEmptyState).toBe(true);

  if (hasContent) {
    // Test content-specific functionality
    await expect(page.locator('[data-testid="content-item"]')).toHaveCount(expect.any(Number));
  } else {
    // Test empty state functionality
    await expect(page.locator('[data-testid="empty-message"]')).toBeVisible();
  }
});
```

### Error Context and Messages

```typescript
test('should validate with clear error messages', async ({ page }) => {
  const projectCards = page.locator('[data-testid="project-card"]');
  const cardCount = await projectCards.count();

  // Provide context in assertions
  expect(cardCount).toBeGreaterThan(0, 'Should have at least one project card after loading');

  // Test each card structure
  for (let i = 0; i < cardCount; i++) {
    const card = projectCards.nth(i);
    await expect(card.locator('[data-testid="project-title"]')).toBeVisible({
      message: `Project card ${i} should have a visible title`,
    });
  }
});
```

### Debug Information Collection

```typescript
test('should collect debug info on failure', async ({ page }) => {
  try {
    await expect(page.locator('[data-testid="critical-element"]')).toBeVisible();
  } catch (error) {
    // Collect debug information
    const url = page.url();
    const title = await page.title();
    const screenshot = await page.screenshot();

    console.log(`Test failed on page: ${url}, title: ${title}`);
    throw error;
  }
});
```

## 🚀 Performance Testing Integration

### Core Web Vitals

```typescript
test('should meet performance thresholds', async ({ page }) => {
  const startTime = Date.now();

  await page.goto('/');

  // Wait for main content
  await expect(page.locator('[data-testid="main-content"]')).toBeVisible();

  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000, 'Page should load within 3 seconds');

  // Test Largest Contentful Paint
  const lcp = await page.evaluate(() => {
    return new Promise((resolve) => {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        resolve(lastEntry.startTime);
      }).observe({ entryTypes: ['largest-contentful-paint'] });

      setTimeout(() => resolve(0), 5000);
    });
  });

  expect(lcp).toBeLessThan(2500, 'LCP should be under 2.5 seconds');
});
```

## 📊 Test Maintenance Guidelines

### Regular Review Checklist

**Weekly**:

- [ ] Run full test suite on all browsers
- [ ] Check for flaky tests and investigate
- [ ] Review test execution times

**Monthly**:

- [ ] Update test documentation
- [ ] Review data-testid naming consistency
- [ ] Evaluate new testing patterns
- [ ] Clean up obsolete tests

**Per Feature**:

- [ ] Add both content-based and structural tests
- [ ] Include responsive design validation
- [ ] Test Angular integration points
- [ ] Update test documentation

### Code Review Checklist

**For New Tests**:

- [ ] Uses data-testid attributes appropriately
- [ ] Includes both test types where relevant
- [ ] Has proper waiting strategies
- [ ] Follows naming conventions
- [ ] Includes error handling

**For Test Updates**:

- [ ] Maintains backward compatibility
- [ ] Updates related documentation
- [ ] Preserves test coverage
- [ ] Improves reliability

## 🎯 Implementation Guidelines

### Adding Tests for New Features

1. **Plan Test Architecture**
   - Identify user journeys (content-based tests)
   - Identify technical validations (structural tests)
   - Consider responsive requirements

2. **Add Data-TestID Attributes**
   - Follow naming conventions
   - Add hierarchical structure
   - Include dynamic attributes where needed

3. **Implement Tests**
   - Start with structural tests (faster to run)
   - Add content-based tests for user journeys
   - Include responsive validation

4. **Validate and Document**
   - Run tests across all browsers
   - Update relevant documentation
   - Add to maintenance schedule

This comprehensive testing approach ensures reliable, maintainable tests that provide confidence in both user experience and technical implementation while supporting long-term project sustainability.

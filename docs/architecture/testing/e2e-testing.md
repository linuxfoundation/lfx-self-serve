# End-to-End Testing

## 🎭 E2E Testing Strategy

End-to-end tests verify complete user workflows from browser interaction to backend processing, ensuring the entire application works as expected from a user's perspective.

## 🛠 Testing Tools

### Primary E2E Framework

**Playwright** (Recommended)

- Cross-browser testing (Chromium, Firefox, Safari)
- Modern async/await API
- Built-in waiting strategies
- Parallel test execution
- Great developer experience

**Alternative: Cypress**

- Developer-friendly debugging
- Time-travel debugging
- Real-time browser preview
- Chrome-based testing

## 🔧 Playwright Configuration

### Setup Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:4000",
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  webServer: {
    command: "yarn start",
    url: "http://localhost:4000",
    reuseExistingServer: !process.env["CI"],
    timeout: 120000,
  },
});
```

## 🎯 Core User Workflows

### Authentication Flow

```typescript
// e2e/auth.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("should redirect unauthenticated users to Auth0", async ({ page }) => {
    await page.goto("/");

    // Should redirect to Auth0
    await expect(page).toHaveURL(/auth0\.com/);

    // Should see Auth0 login form
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
  });

  test("should complete login flow", async ({ page }) => {
    await page.goto("/");

    // Wait for Auth0 redirect
    await page.waitForURL(/auth0\.com/);

    // Fill login form
    await page.fill('[data-testid="email-input"]', "test@example.com");
    await page.fill('[data-testid="password-input"]', "test-password");
    await page.click('[data-testid="login-button"]');

    // Should redirect back to application
    await page.waitForURL("http://localhost:4000/");

    // Should see authenticated state
    await expect(page.locator('[data-testid="user-avatar"]')).toBeVisible();
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
  });

  test("should handle logout", async ({ page, context }) => {
    // Assume authenticated state
    await context.addCookies([
      {
        name: "appSession",
        value: "mock-session-token",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/");

    // Click user menu
    await page.click('[data-testid="user-avatar"]');
    await page.click('[data-testid="logout-button"]');

    // Should redirect to logout and back to Auth0
    await expect(page).toHaveURL(/auth0\.com/);
  });
});
```

### Project Navigation

```typescript
// e2e/navigation.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Project Navigation", () => {
  test.beforeEach(async ({ page, context }) => {
    // Mock authenticated state
    await context.addCookies([
      {
        name: "appSession",
        value: "mock-session-token",
        domain: "localhost",
        path: "/",
      },
    ]);
  });

  test("should navigate from home to project page", async ({ page }) => {
    await page.goto("/");

    // Wait for projects to load
    await expect(
      page.locator('[data-testid="project-card"]').first(),
    ).toBeVisible();

    // Click on first project
    const firstProject = page.locator('[data-testid="project-card"]').first();
    const projectTitle = await firstProject.locator("h3").textContent();
    await firstProject.click();

    // Should navigate to project page
    await expect(page).toHaveURL(/\/project\/[^\/]+$/);

    // Should show project details
    await expect(page.locator('[data-testid="project-title"]')).toHaveText(
      projectTitle || "",
    );
    await expect(
      page.locator('[data-testid="project-navigation"]'),
    ).toBeVisible();
  });

  test("should navigate between project tabs", async ({ page }) => {
    await page.goto("/project/kubernetes");

    // Should show meetings tab by default
    await expect(
      page.locator('[data-testid="meetings-content"]'),
    ).toBeVisible();

    // Click committees tab
    await page.click('[data-testid="committees-tab"]');
    await expect(page).toHaveURL("/project/kubernetes/committees");
    await expect(
      page.locator('[data-testid="committees-content"]'),
    ).toBeVisible();

    // Click mailing lists tab
    await page.click('[data-testid="mailing-lists-tab"]');
    await expect(page).toHaveURL("/project/kubernetes/mailing-lists");
    await expect(
      page.locator('[data-testid="mailing-lists-content"]'),
    ).toBeVisible();
  });

  test("should maintain navigation state on page reload", async ({ page }) => {
    await page.goto("/project/kubernetes/committees");

    // Reload page
    await page.reload();

    // Should maintain state
    await expect(page).toHaveURL("/project/kubernetes/committees");
    await expect(page.locator('[data-testid="committees-tab"]')).toHaveClass(
      /active/,
    );
    await expect(
      page.locator('[data-testid="committees-content"]'),
    ).toBeVisible();
  });
});
```

### Search and Filtering

```typescript
// e2e/search.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Search and Filtering", () => {
  test.beforeEach(async ({ page, context }) => {
    // Mock authenticated state
    await context.addCookies([
      {
        name: "appSession",
        value: "mock-session-token",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto("/");
  });

  test("should filter projects by search term", async ({ page }) => {
    // Wait for projects to load
    await expect(page.locator('[data-testid="project-card"]')).toHaveCount(
      expect.any(Number),
    );
    const initialCount = await page
      .locator('[data-testid="project-card"]')
      .count();

    // Enter search term
    await page.fill('[data-testid="search-input"]', "kubernetes");

    // Should filter results
    await expect(page.locator('[data-testid="project-card"]')).toHaveCount(
      expect.any(Number),
    );
    const filteredCount = await page
      .locator('[data-testid="project-card"]')
      .count();

    // Filtered count should be less than or equal to initial
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // All visible projects should match search term
    const projectTitles = await page
      .locator('[data-testid="project-card"] h3')
      .allTextContents();
    projectTitles.forEach((title) => {
      expect(title.toLowerCase()).toContain("kubernetes");
    });
  });

  test("should clear search filter", async ({ page }) => {
    // Enter search term
    await page.fill('[data-testid="search-input"]', "nonexistent");

    // Should show no results
    await expect(page.locator('[data-testid="no-results"]')).toBeVisible();

    // Clear search
    await page.fill('[data-testid="search-input"]', "");

    // Should show all projects again
    await expect(page.locator('[data-testid="project-card"]')).toHaveCount(
      expect.any(Number),
    );
    await expect(page.locator('[data-testid="no-results"]')).not.toBeVisible();
  });
});
```

## 📱 Responsive Testing

### Mobile and Desktop Views

```typescript
// e2e/responsive.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Responsive Design", () => {
  test("should display mobile navigation", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto("/");

    // Mobile menu should be hidden initially
    await expect(page.locator('[data-testid="mobile-menu"]')).not.toBeVisible();

    // Click hamburger menu
    await page.click('[data-testid="mobile-menu-button"]');

    // Mobile menu should be visible
    await expect(page.locator('[data-testid="mobile-menu"]')).toBeVisible();

    // Navigation items should be stacked vertically
    const menuItems = page.locator(
      '[data-testid="mobile-menu"] [data-testid="nav-item"]',
    );
    await expect(menuItems).toHaveCount(expect.any(Number));
  });

  test("should adapt project grid for different screen sizes", async ({
    page,
  }) => {
    await page.goto("/");

    // Desktop: Should show multiple columns
    await page.setViewportSize({ width: 1200, height: 800 });
    const desktopColumns = await page
      .locator('[data-testid="project-grid"]')
      .evaluate((el) => {
        return getComputedStyle(el).gridTemplateColumns.split(" ").length;
      });

    // Tablet: Should show fewer columns
    await page.setViewportSize({ width: 768, height: 1024 });
    const tabletColumns = await page
      .locator('[data-testid="project-grid"]')
      .evaluate((el) => {
        return getComputedStyle(el).gridTemplateColumns.split(" ").length;
      });

    // Mobile: Should show single column
    await page.setViewportSize({ width: 375, height: 667 });
    const mobileColumns = await page
      .locator('[data-testid="project-grid"]')
      .evaluate((el) => {
        return getComputedStyle(el).gridTemplateColumns.split(" ").length;
      });

    expect(desktopColumns).toBeGreaterThan(tabletColumns);
    expect(tabletColumns).toBeGreaterThan(mobileColumns);
    expect(mobileColumns).toBe(1);
  });
});
```

## ⚡ Performance Testing

### Core Web Vitals

```typescript
// e2e/performance.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Performance", () => {
  test("should meet Core Web Vitals thresholds", async ({ page }) => {
    await page.goto("/");

    // Measure First Contentful Paint
    const fcpMetric = await page.evaluate(() => {
      return new Promise((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const fcp = entries.find(
            (entry) => entry.name === "first-contentful-paint",
          );
          if (fcp) resolve(fcp.startTime);
        }).observe({ entryTypes: ["paint"] });
      });
    });

    // FCP should be under 1.8 seconds
    expect(fcpMetric).toBeLessThan(1800);

    // Measure Largest Contentful Paint
    const lcpMetric = await page.evaluate(() => {
      return new Promise((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          resolve(lastEntry.startTime);
        }).observe({ entryTypes: ["largest-contentful-paint"] });

        // Fallback timeout
        setTimeout(() => resolve(0), 5000);
      });
    });

    // LCP should be under 2.5 seconds
    expect(lcpMetric).toBeLessThan(2500);
  });

  test("should load projects within acceptable time", async ({ page }) => {
    const startTime = Date.now();

    await page.goto("/");

    // Wait for projects to load
    await expect(
      page.locator('[data-testid="project-card"]').first(),
    ).toBeVisible();

    const loadTime = Date.now() - startTime;

    // Should load within 3 seconds
    expect(loadTime).toBeLessThan(3000);
  });
});
```

## 🔧 Test Utilities

### Page Object Model

```typescript
// e2e/pages/project-page.ts
import { Page, Locator } from "@playwright/test";

export class ProjectPage {
  readonly page: Page;
  readonly projectTitle: Locator;
  readonly projectDescription: Locator;
  readonly navigationTabs: Locator;
  readonly meetingsTab: Locator;
  readonly committeesTab: Locator;
  readonly mailingListsTab: Locator;

  constructor(page: Page) {
    this.page = page;
    this.projectTitle = page.locator('[data-testid="project-title"]');
    this.projectDescription = page.locator(
      '[data-testid="project-description"]',
    );
    this.navigationTabs = page.locator('[data-testid="project-navigation"]');
    this.meetingsTab = page.locator('[data-testid="meetings-tab"]');
    this.committeesTab = page.locator('[data-testid="committees-tab"]');
    this.mailingListsTab = page.locator('[data-testid="mailing-lists-tab"]');
  }

  async goto(projectSlug: string) {
    await this.page.goto(`/project/${projectSlug}`);
  }

  async navigateToMeetings() {
    await this.meetingsTab.click();
  }

  async navigateToCommittees() {
    await this.committeesTab.click();
  }

  async navigateToMailingLists() {
    await this.mailingListsTab.click();
  }

  async getProjectTitle() {
    return await this.projectTitle.textContent();
  }
}

// Usage in tests
test("should navigate project tabs", async ({ page }) => {
  const projectPage = new ProjectPage(page);
  await projectPage.goto("kubernetes");

  await projectPage.navigateToCommittees();
  await expect(page).toHaveURL("/project/kubernetes/committees");
});
```

### Authentication Helpers

```typescript
// e2e/helpers/auth.ts
import { Page, BrowserContext } from "@playwright/test";

export async function loginUser(page: Page, context: BrowserContext) {
  // Add authentication cookie
  await context.addCookies([
    {
      name: "appSession",
      value: "mock-authenticated-session",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
    },
  ]);

  // Navigate to authenticated page
  await page.goto("/");

  // Verify authentication
  await page.waitForSelector('[data-testid="user-avatar"]');
}

export async function logoutUser(page: Page) {
  await page.click('[data-testid="user-avatar"]');
  await page.click('[data-testid="logout-button"]');
  await page.waitForURL(/auth0\.com/);
}
```

## 🎯 Test Data Management

### Test Data Setup

```typescript
// e2e/fixtures/test-data.ts
export const testProjects = [
  {
    id: "kubernetes",
    name: "Kubernetes",
    description: "Container orchestration platform",
    category: "CNCF",
    metrics: {
      meetings: 12,
      committees: 8,
      mailingLists: 15,
    },
  },
  {
    id: "prometheus",
    name: "Prometheus",
    description: "Monitoring and alerting toolkit",
    category: "CNCF",
    metrics: {
      meetings: 8,
      committees: 4,
      mailingLists: 6,
    },
  },
];

export async function seedTestData(page: Page) {
  // Mock API responses
  await page.route("/api/projects", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(testProjects),
    });
  });
}
```

## 🔄 CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: yarn install

      - name: Build application
        run: yarn build

      - name: Install Playwright
        run: yarn playwright install --with-deps

      - name: Run E2E tests
        run: yarn playwright test

      - name: Upload test results
        uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

## 📊 Best Practices

### E2E Testing Guidelines

1. **Test User Journeys**: Focus on complete user workflows
2. **Use Data Test IDs**: Reliable element selection
3. **Avoid Flaky Tests**: Proper waiting strategies
4. **Test Critical Paths**: Cover most important user flows
5. **Keep Tests Independent**: Each test should be isolated

### Performance Optimization

1. **Parallel Execution**: Run tests in parallel when possible
2. **Smart Waiting**: Use built-in wait strategies
3. **Resource Management**: Clean up browser resources
4. **Test Data**: Use efficient test data setup
5. **CI Optimization**: Optimize for CI/CD environments

### Debugging and Maintenance

1. **Visual Debugging**: Use screenshots and videos
2. **Trace Analysis**: Leverage Playwright traces
3. **Error Reporting**: Clear error messages
4. **Test Stability**: Regular test maintenance
5. **Documentation**: Document test scenarios

## 🔄 Implementation Status

### ✅ Ready for Implementation

- Playwright configuration
- Authentication flow testing
- Navigation testing
- Responsive design testing
- Performance testing patterns

### 🔲 Future Enhancements

- Cross-browser testing matrix
- Visual regression testing
- Accessibility testing
- Load testing integration
- Test reporting dashboard

This E2E testing strategy ensures comprehensive coverage of user workflows and provides confidence in the application's behavior across different browsers and devices.

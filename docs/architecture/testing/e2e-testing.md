# End-to-End Testing Architecture

E2E tests live in `apps/lfx-one/e2e/` and are driven by Playwright. This doc covers the dual-architecture approach, the `data-testid` conventions, and the Auth0 global-setup strategy. Specs in the tree today cover badges, marketing dashboard, and the profile-identities verify flow; new specs should follow the same patterns.

## Current State

```text
apps/lfx-one/
├── e2e/
│   ├── badges-dashboard.spec.ts                     # content-based
│   ├── marketing-dashboard.spec.ts                  # content-based
│   ├── profile-identities-verify.spec.ts            # content-based
│   ├── profile-identities-verify-robust.spec.ts     # structural
│   ├── fixtures/
│   │   └── mock-data/
│   │       ├── index.ts
│   │       └── projects.mock.ts
│   └── helpers/
│       ├── auth.helper.ts           # Auth0 login helper
│       ├── api-mock.helper.ts       # page.route() utilities
│       └── global-setup.ts          # runs once before the suite, saves auth state
├── playwright/
│   └── .auth/user.json              # auth state produced by global-setup (gitignored)
└── playwright.config.ts             # dev server + 3 browser projects
```

Run the suite:

```bash
yarn e2e           # headless, all browsers
yarn e2e:ui        # Playwright UI mode
yarn e2e:headed    # visible browser
```

Playwright boots `yarn start` automatically (`webServer` block in `playwright.config.ts`) and reuses the existing dev server if one is running — you don't need to start it separately.

## Dual Testing Architecture

Every feature that warrants E2E coverage gets two specs:

| Spec type     | Filename suffix            | Purpose                                                     | Target                                                           |
| ------------- | -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Content-based | `[feature].spec.ts`        | Validate user-visible behavior and workflows                | Text, form interactions, route transitions, dialog open/close    |
| Structural    | `[feature]-robust.spec.ts` | Validate component architecture and `data-testid` contracts | `data-testid` presence/nesting, signal-driven state, DOM tagName |

The pair lets each side fail independently: if a translation changes, only the content-based spec breaks; if a component is replaced but keeps the same `data-testid` surface, the structural spec still passes. The current profile-identities pair demonstrates this — see `profile-identities-verify.spec.ts` (content) and `profile-identities-verify-robust.spec.ts` (structural) for a real side-by-side example.

## `data-testid` Architecture

### Naming convention

`[section]-[component]-[element]`, lowercase with dashes. Examples from the current tree:

- Section-level: `unverified-identities-section`, `verified-identities-section`
- Component-level: `badges-filter-pills`, `badges-empty-state-card`, `profile-identities`
- Element-level: `add-identity-btn`, `badges-filter-btn`, `badges-error-state-card`
- Dynamic identity: `identity-row-${id}`, `verify-btn-${id}`, `badge-card-${slug}`

### Dynamic attributes for state

When a list element's identity matters, encode it in the testid rather than relying on position:

```html
<!-- apps/lfx-one/src/app/modules/profile/identities/identities.component.html (pattern) -->
<div [attr.data-testid]="'identity-row-' + identity.id">
  <button [attr.data-testid]="'verify-btn-' + identity.id">Verify</button>
</div>
```

This is what allows the profile-identities specs to assert per-row behavior without depending on DOM order:

```typescript
// apps/lfx-one/e2e/profile-identities-verify-robust.spec.ts (excerpt)
const ids = ['idf-1', 'idf-2', 'idf-3', 'idf-5', 'idf-6'];
for (const id of ids) {
  await expect(page.getByTestId(`identity-row-${id}`)).toBeAttached();
}
```

### Selector-prefix queries for collections

Use `[data-testid^="prefix-"]` when you want to count or iterate over all items in a list without hardcoding identifiers:

```typescript
// apps/lfx-one/e2e/badges-dashboard.spec.ts (excerpt)
const firstCard = page.locator('[data-testid^="badge-card-"]').first();
await expect(firstCard).toBeVisible();
```

## Test Patterns

### Structural component validation

Assert the `data-testid` contract that pages promise to maintain:

```typescript
// profile-identities-verify-robust.spec.ts
test('should have root container with grid class', async ({ page }) => {
  const root = page.getByTestId('profile-identities');
  await expect(root).toBeAttached();
  await expect(root).toHaveClass(/grid/);
});

test('should have 2 rows in unverified section (idf-2, idf-6)', async ({ page }) => {
  const section = page.getByTestId('unverified-identities-section');
  const rows = section.locator('[data-testid^="identity-row-"]');
  await expect(rows).toHaveCount(2);
});
```

### Content-based user journey

Drive the UI through a real workflow:

```typescript
// profile-identities-verify.spec.ts (shape)
test('should show Verify buttons only on unverified identities', async ({ page }) => {
  await expect(page.getByTestId('verify-btn-idf-2')).toBeVisible();
  await expect(page.getByTestId('verify-btn-idf-6')).toBeVisible();

  await expect(page.getByTestId('verify-btn-idf-1')).not.toBeAttached();
  await expect(page.getByTestId('verify-btn-idf-3')).not.toBeAttached();
});
```

### Error-state coverage via route mocking

`page.route()` stubs specific API responses so error paths can be verified deterministically without backend help:

```typescript
// badges-dashboard.spec.ts
test.describe('Badges Dashboard error state', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/badges', (route) => route.fulfill({ status: 500, body: 'Internal Server Error' }));
    await page.goto('/badges', { waitUntil: 'domcontentloaded' });
  });

  test('error state renders when API fails', async ({ page }) => {
    await expect(page.getByTestId('badges-error-state-card')).toBeVisible();
  });
});
```

### "Either-or" visibility

When a page can render in one of two valid shapes (loaded-with-data vs. empty state), use `.or()` instead of conditionals:

```typescript
// badges-dashboard.spec.ts
const grid = page.getByTestId('badges-grid');
const emptyState = page.getByTestId('badges-empty-state-card');
await expect(grid.or(emptyState)).toBeVisible({ timeout: 30_000 });
```

### Dialog / popover interactions

Assert on the trigger's aria-label before/after state, not just visibility:

```typescript
// badges-dashboard.spec.ts
test('filter button aria-label updates when a filter is active', async ({ page }) => {
  const filterBtn = page.getByTestId('badges-filter-btn');
  await expect(filterBtn).toHaveAttribute('aria-label', 'Open filter options');

  await filterBtn.click();
  // ... interact with the popover
  await expect(filterBtn).toHaveAttribute('aria-label', 'Open filter options (filters active)');
});
```

## Browser Projects

`playwright.config.ts` defines three projects, all sharing the saved auth state under `playwright/.auth/user.json`:

| Project         | Device          | Workers            | Notes                                            |
| --------------- | --------------- | ------------------ | ------------------------------------------------ |
| `chromium`      | Desktop Chrome  | default (parallel) | Primary dev target.                              |
| `firefox`       | Desktop Firefox | default (parallel) | Increased `actionTimeout` / `navigationTimeout`. |
| `mobile-chrome` | Pixel 5 (touch) | 1                  | Single worker to avoid resource contention.      |

Parallelism is on by default (`fullyParallel: true`). CI caps workers to 1 and enables 2 retries.

## Authentication

Auth0 login runs once in `e2e/helpers/global-setup.ts` before any specs execute, and the resulting cookies/storage are persisted to `playwright/.auth/user.json`. Every project in `playwright.config.ts` loads that `storageState`, so individual specs land on routes already authenticated:

```typescript
// e2e/helpers/global-setup.ts (shape)
async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/logout`);
    await AuthHelper.loginWithAuth0(page, TEST_CREDENTIALS);
    await context.storageState({ path: 'playwright/.auth/user.json' });
  } finally {
    await browser.close();
  }
}
```

Specs rely on this by checking they didn't get bounced back to Auth0:

```typescript
await page.goto('/badges', { waitUntil: 'domcontentloaded' });
await expect(page).not.toHaveURL(/auth0\.com/);
```

Required env vars (loaded from `.env` by both `playwright.config.ts` via `dotenv` and `e2e/helpers/global-setup.ts` via `process.env`): `TEST_USERNAME`, `TEST_PASSWORD`.

## Best Practices

### Element selection priority

1. **`getByTestId()`** — preferred. Survives copy, layout, and styling changes.
2. **Semantic queries** (`getByRole`, `getByLabel`) — acceptable for accessibility-sensitive flows (buttons with clear ARIA, form labels).
3. **`getByText`** — acceptable only for static UI labels that you also assert on; avoid for generic "Submit"-style text.
4. **CSS class selectors** — avoid. Tailwind classes churn and will break tests that don't need to.

### Waiting strategies

- `await expect(locator).toBeVisible()` — built-in auto-wait, preferred over `waitForSelector`.
- `await page.waitForLoadState('domcontentloaded')` — use on `page.goto()` for fast handoff to the app shell.
- `await page.waitForLoadState('networkidle')` — avoid unless you have dynamic content without testable markers; it can hang on SSE or long-polling endpoints.

### Timeouts

Declare long-running data timeouts as constants per spec file rather than sprinkling literals:

```typescript
const DATA_LOAD_TIMEOUT = 30_000;
test.setTimeout(60_000);
```

This matches what `badges-dashboard.spec.ts` does and makes tuning easier in CI.

### Describe-block grouping

Group by screen and then by concern. The profile-identities-verify-robust file models this well:

```typescript
test.describe('Identities Verify Flow - Robust Tests', () => {
  test.describe('Data-testid presence', () => {
    /* ... */
  });
  test.describe('Section structure', () => {
    /* ... */
  });
  test.describe('Row actions', () => {
    /* ... */
  });
});
```

## Debugging

- `yarn e2e:headed` to see the browser drive the app.
- `yarn e2e:ui` for Playwright's UI runner with per-step time travel.
- Traces (`trace: 'on-first-retry'` in `playwright.config.ts`) are written under `test-results/` when a retry happens — open with `npx playwright show-trace <path>`.
- Failure screenshots are captured automatically (`screenshot: 'only-on-failure'`).

## Adding a New Spec

For a new feature, write both specs together:

1. Add `data-testid` attributes while building the component (section, container, element, action levels).
2. Create `feature-name.spec.ts` — drive the page through its golden-path workflow.
3. Create `feature-name-robust.spec.ts` — assert the `data-testid` contract (presence, nesting, counts, dynamic suffixes).
4. If the feature has an error path, mock the relevant API with `page.route()` and cover the error-state component.
5. Verify locally with `yarn e2e` before opening a PR.

## Related

- [Testing Best Practices](testing-best-practices.md) — deeper treatment of dual architecture and `data-testid` conventions.
- [Playwright docs](https://playwright.dev/) — for Playwright-specific APIs not covered here.

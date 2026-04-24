# Testing Best Practices

Deeper treatment of the patterns introduced in [E2E Testing](e2e-testing.md). Start there for the dual-architecture overview, the `data-testid` naming convention, and the auth-setup flow; this doc focuses on the finer-grained rules that make specs reliable and easy to maintain.

## Element Selection Priority

Always choose the most specific, least brittle selector. In priority order:

### 1. `getByTestId()` — preferred for UI elements

Survives copy, layout, styling, and library changes. Every LFX One component exposes its own `data-testid` surface, so feature specs should never reach below it with CSS selectors.

```typescript
// profile-identities-verify.spec.ts
await expect(page.getByTestId('identity-row-idf-2')).toContainText('jdoe@company.org');
```

### 2. Semantic queries — acceptable for accessibility-sensitive flows

`getByRole`, `getByLabel`, and `getByPlaceholder` read well and exercise accessibility metadata at the same time. Use them for form labels, buttons with meaningful ARIA names, and headings.

```typescript
await expect(page.getByRole('button', { name: 'Open filter options' })).toBeVisible();
await expect(page.getByLabel('Project Name')).toBeFocused();
```

### 3. `getByText()` — narrow, assert-and-act only

Acceptable for copy that is itself part of the assertion (empty states, status tags). Don't use it as a primary locator for interactive elements — translations and copy changes break tests that don't need to.

```typescript
await expect(page.getByText('No badges yet')).toBeVisible(); // ✓ asserting empty-state copy
```

### 4. CSS selectors — last resort, prefix-scoped

Only reach for raw CSS when querying a _set_ of `data-testid`s sharing a prefix:

```typescript
// badges-dashboard.spec.ts
const firstCard = page.locator('[data-testid^="badge-card-"]').first();
```

Avoid these outright:

```typescript
// ❌ Brittle: Tailwind classes change frequently
await expect(page.locator('.bg-blue-500.text-white')).toBeVisible();

// ❌ Fragile: DOM structure changes with refactors
await expect(page.locator('div > div:nth-child(2) > span')).toBeVisible();

// ❌ Non-specific: will match too much
await expect(page.locator('button')).toBeVisible();
```

## Waiting Strategies

### Prefer built-in auto-waiting

`expect(locator).toBeVisible()` and `locator.click()` already wait for the element to be actionable. Don't wrap them in `waitForSelector` or manual timers.

```typescript
// ✓ auto-waits
await expect(page.getByTestId('badges-grid')).toBeVisible({ timeout: 30_000 });

// ✗ redundant
await page.waitForSelector('[data-testid="badges-grid"]');
await expect(page.getByTestId('badges-grid')).toBeVisible();
```

### Use `.or()` for either-or visibility

When a page can legitimately render in one of two valid shapes, don't branch — assert the union:

```typescript
// badges-dashboard.spec.ts
const grid = page.getByTestId('badges-grid');
const emptyState = page.getByTestId('badges-empty-state-card');
await expect(grid.or(emptyState)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
```

### Scope `networkidle` carefully

`page.waitForLoadState('networkidle')` is useful for pages with heavy initial fetches, but it hangs on endpoints with persistent connections (SSE, WebSockets, long-poll). Prefer asserting on a specific "ready" `data-testid` instead:

```typescript
// ✓ deterministic
await expect(page.getByTestId('profile-identities')).toBeAttached();

// ⚠ hangs if the dashboard opens an SSE stream
await page.waitForLoadState('networkidle');
```

### Avoid fixed `waitForTimeout`

```typescript
// ❌ brittle and slow
await page.waitForTimeout(3000);

// ✓ wait for a real signal
await expect(page.getByTestId('badges-grid')).toBeVisible();
```

## Timeouts

Declare per-spec constants for anything longer than Playwright's defaults and reuse them across the file. This matches `badges-dashboard.spec.ts`:

```typescript
const BADGES_URL = '/badges';
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(60_000);

test('shows badge grid or empty state after loading', async ({ page }) => {
  await expect(page.getByTestId('badges-grid').or(page.getByTestId('badges-empty-state-card'))).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
});
```

Tuning a single constant at the top of the file is easier than chasing literals, and a short Playwright default (`5000ms`) is almost always wrong for data-fetching pages.

## `data-testid` Patterns

### Hierarchical naming

Follow `[section]-[component]-[element]` from the root down:

```text
profile-identities                    # root section
  unverified-identities-section       # subsection
    identity-row-idf-2                # row (dynamic id)
      verify-btn-idf-2                # action (dynamic id)
```

Don't bury an element's `data-testid` inside an ancestor-specific prefix if the element itself is reused elsewhere — prefer the element-level `data-testid` and chain locators if you need scoping:

```typescript
// ✓ chain locators
const section = page.getByTestId('unverified-identities-section');
await expect(section.getByTestId('identity-row-idf-2')).toBeVisible();

// ✗ proliferates test IDs
await expect(page.getByTestId('unverified-identities-section-identity-row-idf-2')).toBeVisible();
```

### Encode identity in dynamic `data-testid`s

When a list needs per-item assertions, encode the stable identifier in the `data-testid` rather than relying on nth-child:

```html
<!-- template pattern -->
<div [attr.data-testid]="'identity-row-' + identity.id">
  <button [attr.data-testid]="'verify-btn-' + identity.id">Verify</button>
</div>
```

This is what makes `profile-identities-verify-robust.spec.ts` able to assert presence across five rows without hardcoding position:

```typescript
const ids = ['idf-1', 'idf-2', 'idf-3', 'idf-5', 'idf-6'];
for (const id of ids) {
  await expect(page.getByTestId(`identity-row-${id}`)).toBeAttached();
}
```

### Prefer `data-testid` attributes over class-based identity

If you need a "group name" for a set of elements (e.g. all status tags in a table), encode it in an additional `data-*` attribute, not a CSS class. Tests can match on the attribute without coupling to the stylesheet.

```html
<span [attr.data-testid]="'status-tag-' + row.id" [attr.data-status]="row.status">{{ row.statusLabel }}</span>
```

## Error-State Coverage

Use `page.route()` to stub API responses so you can assert error paths without needing the backend to fail. This is the canonical pattern from `badges-dashboard.spec.ts`:

```typescript
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

Scope the stub to the specific endpoint (glob) that the page calls. Stubbing broader patterns (`**/api/**`) can mask bugs in unrelated fetches.

## `beforeEach` Patterns

Put everything that a spec needs to know the page is ready in a single `beforeEach`:

```typescript
// profile-identities-verify-robust.spec.ts
test.beforeEach(async ({ page }) => {
  await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('unverified-identities-section').or(page.getByTestId('verified-identities-section'))).toBeVisible({ timeout: 10000 });
});
```

Three things happen in order: navigation, auth sanity check, ready-state wait. Don't repeat these in every test.

## Describe-Block Structure

Group by screen first, then by concern. The profile-identities-verify-robust file models this well:

```typescript
test.describe('Identities Verify Flow - Robust Tests', () => {
  test.describe('Data-testid presence', () => {
    test('should have root container with grid class', ...);
    test('should have unverified-identities-section', ...);
  });

  test.describe('Section structure', () => {
    test('should have 2 rows in unverified section', ...);
    test('should have 3 rows in verified section', ...);
  });

  test.describe('Row actions', () => {
    test('should have verify-btn `data-testid`s only on unverified rows', ...);
  });
});
```

Each inner describe maps to one user-facing concern, which keeps failures easy to attribute.

## Anti-Patterns

- **Asserting before navigation settles.** `page.goto()` returns when the HTTP response lands, not when Angular has rendered. Always chain an `expect(...).toBeVisible()` on a "ready" `data-testid` before other assertions.
- **Relying on test order.** Tests run in parallel by default. Don't write "test 2 depends on test 1 having created a record." Each test should set up its own state.
- **Hardcoding response bodies in assertions.** `expect(row).toContainText('jdoe@company.org')` is fine for fixture-backed specs; for real-API specs, assert on a shape or pattern instead.
- **Over-mocking.** The purpose of E2E is to exercise integration. Mock only the endpoint you're trying to failover — leave everything else live against the dev server.
- **Forgetting the Auth0 check.** If a spec renders with "Sign in" visible, global-setup didn't pin auth state and the entire test is validating the login page. Every `beforeEach` should have `await expect(page).not.toHaveURL(/auth0\.com/);` as its second line.

## Related

- [E2E Testing](e2e-testing.md) — the starting point: dual architecture, `data-testid` conventions, auth setup, current specs in the tree.
- [Playwright Locators](https://playwright.dev/docs/locators) — the built-in selector API.
- [Playwright Assertions](https://playwright.dev/docs/test-assertions) — the auto-waiting `expect` matchers.

# Shared Package & SQL Review Checklist

Standards for the shared package (`@lfx-one/shared`) and Snowflake SQL queries.

---

## Shared Package

### 1. Interfaces and type aliases in shared (SHOULD FIX)

Prefer defining reusable interfaces **and type aliases** in `packages/shared/src/interfaces/<name>.interface.ts`. Truly local UI-only types with no reuse potential may remain local in a component, but shared or reusable types should not be defined there.

This includes **derived type aliases** such as `type Foo = (typeof BAR)[keyof typeof BAR]`: the alias lives in the interface file even when the `BAR` constant it derives from lives in a constants file. Import the constant into the interface file to derive the alias.

**Violation:**

```typescript
// In a component file
interface MeetingDetails {
  id: string;
  title: string;
  date: Date;
}
```

**Fix:**

```typescript
// packages/shared/src/interfaces/meeting.interface.ts
export interface MeetingDetails {
  id: string;
  title: string;
  date: Date;
}

// In the component
import { MeetingDetails } from '@lfx-one/shared/interfaces';
```

**Violation (derived alias in a constants file):**

```typescript
// packages/shared/src/constants/events.constants.ts
export const MY_EVENT_STATUS = { ATTENDED: 'Attended', REGISTERED: 'Registered' } as const;
export type MyEventStatus = (typeof MY_EVENT_STATUS)[keyof typeof MY_EVENT_STATUS]; // ❌ type in constants file
```

**Fix (constant stays; alias moves to the interface file):**

```typescript
// packages/shared/src/constants/events.constants.ts — value only
export const MY_EVENT_STATUS = { ATTENDED: 'Attended', REGISTERED: 'Registered' } as const;

// packages/shared/src/interfaces/events.interface.ts — derived alias
import { MY_EVENT_STATUS } from '../constants/events.constants';

export type MyEventStatus = (typeof MY_EVENT_STATUS)[keyof typeof MY_EVENT_STATUS];

// Consumers import the value and the type from their respective barrels
import { MY_EVENT_STATUS } from '@lfx-one/shared/constants';
import { MyEventStatus } from '@lfx-one/shared/interfaces';
```

---

### 2. Constants in shared (SHOULD FIX)

All constants belong in `packages/shared/src/constants/<name>.constants.ts`. Use `as const` for constant objects.

Constants files export **runtime values only** (`const`, `as const` objects, `Set`, arrays) — no `export type` or `export interface`. Types and derived aliases belong in the matching `.interface.ts` (see item 1).

**Violation:**

```typescript
// In a component or service file
const STATUS_LABELS = { active: 'Active', inactive: 'Inactive' };
```

**Fix:**

```typescript
// packages/shared/src/constants/status.constants.ts
export const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
} as const;
```

---

### 3. Enums in shared (SHOULD FIX)

All enums belong in `packages/shared/src/enums/<name>.enum.ts`.

**Violation:**

```typescript
// In a component file
enum MeetingStatus {
  Scheduled = 'scheduled',
  Cancelled = 'cancelled',
}
```

**Fix:**

```typescript
// packages/shared/src/enums/meeting.enum.ts
export enum MeetingStatus {
  Scheduled = 'scheduled',
  Cancelled = 'cancelled',
}
```

---

### 4. Barrel exports (SHOULD FIX)

New types must be exported from `index.ts` in their directory. Without this, the type cannot be imported via the package path.

**Violation:** Adding `packages/shared/src/interfaces/widget.interface.ts` but not exporting it.

**Fix:** Add to `packages/shared/src/interfaces/index.ts`:

```typescript
export * from './widget.interface';
```

---

### 5. No `as unknown as Type` (CRITICAL)

Never cast through `unknown` to fix type mismatches. Find the proper type solution.

**Violation:**

```typescript
const meeting = response.data as unknown as MeetingInterface;
const config = rawConfig as unknown as AppConfig;
```

**Fix:**

```typescript
// Define proper types that match the actual shape
const meeting: MeetingInterface = response.data;
// Or use a type guard
if (isMeetingInterface(response.data)) {
  const meeting = response.data;
}
```

If the upstream shape truly differs, create a mapping function with explicit types.

---

### 6. TypeScript conventions (NIT)

| Convention                              | Example                              |
| --------------------------------------- | ------------------------------------ |
| `camelCase` for variables and functions | `getUserName`, `meetingCount`        |
| `PascalCase` for classes and interfaces | `MeetingService`, `ProjectInterface` |
| `kebab-case` for file names             | `meeting-details.component.ts`       |
| `SCREAMING_SNAKE_CASE` for constants    | `MAX_RETRY_COUNT`, `API_BASE_URL`    |

---

## SQL (Snowflake)

### 7. Bind parameter matching (CRITICAL)

Every `?` placeholder in SQL must have a corresponding value in the binds array. Count the `?` marks and count the bind values -- they must match exactly. This is the most common SQL bug in the codebase.

**Violation:**

```typescript
const query = `
  SELECT * FROM meetings
  WHERE project_id = ? AND status = ? AND created_by = ?
`;
const binds = [projectId, status];
// 3 placeholders, 2 bind values -- WILL FAIL at runtime
```

**Fix:**

```typescript
const query = `
  SELECT * FROM meetings
  WHERE project_id = ? AND status = ? AND created_by = ?
`;
const binds = [projectId, status, createdBy];
// 3 placeholders, 3 bind values -- correct
```

---

### 8. No string concatenation (CRITICAL)

Never concatenate user input into SQL strings. Always use parameterized queries with `?` placeholders.

**Violation:**

```typescript
const query = `SELECT * FROM users WHERE email = '${email}'`;
const query = "SELECT * FROM users WHERE name = '" + name + "'";
```

**Fix:**

```typescript
const query = 'SELECT * FROM users WHERE email = ?';
const binds = [email];
```

---

### 9. Query Service conventions (SHOULD FIX)

When calling the query service, use the correct parameter names:

| Parameter    | Purpose                    | Note                                                                                          |
| ------------ | -------------------------- | --------------------------------------------------------------------------------------------- |
| `page_size`  | Number of results per page | NOT `limit`                                                                                   |
| `page_token` | Cursor for pagination      | Opaque string from previous response                                                          |
| `name`       | Typeahead search           | Uses `multi_match` with `bool_prefix`                                                         |
| `filters`    | Field filtering            | Format: `field:value`, auto-prefixed with `data.`                                             |
| `sort`       | Sort order                 | Enum: `name_asc` (upstream default), `name_desc`, `updated_asc`, `updated_desc`, `best_match` |

`best_match` opts into upstream `_score` ordering and is meaningful only alongside `name`. Pass it
whenever you pass `name`: the upstream default is `name_asc`, and OpenSearch discards relevance
scoring whenever an explicit non-`_score` sort is present, so omitting it returns the
alphabetically-first page of matches rather than the closest ones.

**Violation:**

```typescript
const params = { limit: 50, offset: 0 };
```

**Fix:**

```typescript
const params = { page_size: 50 };
// For next page: { page_size: 50, page_token: previousResponse.nextPageToken }
```

---

### 10. No business logic in embedded Snowflake SQL (SHOULD FIX)

Metric definitions, derived values, and reusable transformations belong in the [`lf-dbt`](https://github.com/linuxfoundation/lf-dbt) repo — typically in silver, gold, or platinum models — not in LFX One server services. Embedded Snowflake queries own retrieval concerns: selecting modeled columns and applying parameterized `WHERE` filters, `ORDER BY`, and `LIMIT`.

A narrow `SUM`/`MAX` over already-modeled measures may be used only to combine rows for a display scope that dbt does not yet provide, such as an umbrella foundation. It must not redefine a metric. Prefer adding the exact consumption grain to dbt so the application can select one row.

**Do not embed in LFX One:**

- `CASE` expressions that compute business metrics
- Arithmetic on raw columns (percentages, rates, growth, ratios)
- `SUM` / `AVG` / `COUNT` / window functions over fact columns
- Joins, bucketing, or date/metric calculations that define what a number means

If a dashboard needs a new derived field or queryable scope, add it to the appropriate dbt model, document and test it there, then select the named columns from LFX One.

**Violation:**

```typescript
const overviewQuery = `
  SELECT
    SUM(TOTAL_FOLLOWERS) AS TOTAL_FOLLOWERS,
    MAX(PLATFORMS_ACTIVE) AS PLATFORMS_ACTIVE,
    CASE
      WHEN SUM(PRIOR_TOTAL_FOLLOWERS) > 0
        THEN ROUND(
          (SUM(TOTAL_FOLLOWERS) - SUM(PRIOR_TOTAL_FOLLOWERS))
          / SUM(PRIOR_TOTAL_FOLLOWERS) * 100, 1
        )
    END AS FOLLOWER_GROWTH_PCT
  FROM ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_OVERVIEW
  WHERE 1=1
    ${foundationFilter}
`;
// Recomputes follower_growth_pct in the app — logic belongs in dbt
```

**Fix:**

Add a dbt model at the exact consumption grain. This example preserves the original growth calculation while producing one row for every supported scope, including the `tlf` umbrella. Add `unique` and `not_null` tests for `scope_slug` in the model YAML.

```sql
-- lf-dbt: platinum_lfx_one_social_media_overview_by_scope.sql
WITH foundation_scopes AS (
  SELECT
    foundation_slug AS scope_slug,
    SUM(total_followers) AS total_followers,
    MAX(platforms_active) AS platforms_active,
    SUM(prior_total_followers) AS prior_total_followers
  FROM {{ ref('platinum_lfx_one_social_media_overview') }}
  WHERE foundation_slug IS NOT NULL
  GROUP BY 1
),

all_scopes AS (
  SELECT
    scope_slug,
    total_followers,
    platforms_active,
    prior_total_followers
  FROM foundation_scopes
  WHERE scope_slug <> 'tlf'

  UNION ALL

  SELECT
    'tlf' AS scope_slug,
    SUM(total_followers) AS total_followers,
    MAX(platforms_active) AS platforms_active,
    SUM(prior_total_followers) AS prior_total_followers
  FROM foundation_scopes
)

SELECT
  scope_slug,
  total_followers,
  platforms_active,
  CASE
    WHEN prior_total_followers > 0
      THEN ROUND(
        (total_followers - prior_total_followers)
        / prior_total_followers * 100,
        1
      )
  END AS follower_growth_pct
FROM all_scopes
```

```typescript
const overviewQuery = `
  SELECT
    TOTAL_FOLLOWERS,
    PLATFORMS_ACTIVE,
    FOLLOWER_GROWTH_PCT
  FROM ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_OVERVIEW_BY_SCOPE
  WHERE SCOPE_SLUG = ?
`;
const result = await snowflakeService.execute(overviewQuery, [foundationSlug]);
// Exactly one modeled row for both foundation and umbrella scopes
```

**Allowed in LFX One:** filtering by route params (foundation slug, date range), sorting, pagination, and a narrow `SUM`/`MAX` only when combining **already-modeled** measures for a display scope that dbt does not provide. When in doubt, add the scope or logic to dbt.

# Shared Package & SQL Review Checklist

Standards for the shared package (`@lfx-one/shared`) and Snowflake SQL queries.

---

## Shared Package

### 1. Interfaces in shared (SHOULD FIX)

Prefer defining reusable interfaces in `packages/shared/src/interfaces/<name>.interface.ts`. Truly local UI-only types with no reuse potential may remain local in a component, but shared or reusable interfaces should not be defined there.

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

---

### 2. Constants in shared (SHOULD FIX)

All constants belong in `packages/shared/src/constants/<name>.constants.ts`. Use `as const` for constant objects.

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

| Parameter    | Purpose                    | Note                                                         |
| ------------ | -------------------------- | ------------------------------------------------------------ |
| `page_size`  | Number of results per page | NOT `limit`                                                  |
| `page_token` | Cursor for pagination      | Opaque string from previous response                         |
| `name`       | Typeahead search           | Uses `multi_match` with `bool_prefix`                        |
| `filters`    | Field filtering            | Format: `field:value`, auto-prefixed with `data.`            |
| `sort`       | Sort order                 | Enum: `name_asc`, `name_desc`, `updated_asc`, `updated_desc` |

**Violation:**

```typescript
const params = { limit: 50, offset: 0 };
```

**Fix:**

```typescript
const params = { page_size: 50 };
// For next page: { page_size: 50, page_token: previousResponse.nextPageToken }
```

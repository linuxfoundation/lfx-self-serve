# Package Architecture

## Overview

The `@lfx-one/shared` package centralizes types, constants, utilities, and validators used across the monorepo. It is the single source of truth for shared contracts between frontend and backend.

## Package Organization

```text
packages/shared/src/
├── interfaces/       # TypeScript interfaces (all .interface.ts suffix)
├── constants/        # Application constants (colors, font sizes, config)
├── enums/            # Shared enumerations
├── utils/            # Utility functions (generic + domain-specific)
├── validators/       # Angular reactive form validators
└── index.ts          # Main barrel export
```

Each subdirectory has its own `index.ts` barrel file, enabling granular imports.

## Import Patterns

The package supports category-specific imports:

```typescript
// Interfaces
import { User, AuthContext, MeetingResponse } from '@lfx-one/shared/interfaces';

// Constants
import { lfxColors, lfxFontSizes } from '@lfx-one/shared/constants';

// Enums
import { MeetingType, VoteStatus } from '@lfx-one/shared/enums';

// Utilities
import { formatDateToISOString, isValidUrl, stripHtml } from '@lfx-one/shared/utils';

// Validators
import { MeetingValidators } from '@lfx-one/shared/validators';
```

During development, the monorepo uses direct source imports (via TypeScript path mappings) for hot reloading — no need to rebuild the shared package after changes.

## What Goes Where

### Interfaces (`interfaces/`)

All TypeScript interfaces live here — even component-specific ones. This ensures consistent type definitions and makes types discoverable.

**Conventions:**

- File suffix: `.interface.ts` (e.g., `meeting.interface.ts`)
- One domain per file — group related interfaces together
- Export from the barrel `index.ts`
- Use `interface` over `type` unions for better maintainability
- Add JSDoc comments for non-obvious properties

### Constants (`constants/`)

Design tokens (colors, font sizes), configuration values, and static lookup data.

**Conventions:**

- Use `as const` assertions for immutable values
- Group by domain (e.g., `meeting.constants.ts`, `ai.constants.ts`)
- Subdirectories are allowed for large groupings (e.g., `meeting-templates/`)

### Enums (`enums/`)

Shared enumerations used across frontend and backend.

**Conventions:**

- File suffix: `.enum.ts`
- Use string enums for readability in logs and APIs
- Export from the barrel `index.ts`

### Utilities (`utils/`)

Pure functions for common operations, split into **generic** and **domain-specific** modules:

- **Generic**: Color conversion, date formatting, string manipulation, URL validation, file type detection, form helpers, HTML sanitization
- **Domain-specific**: Meeting recurrence logic, RSVP calculations, vote/survey status derivation, poll utilities

**Conventions:**

- File suffix: `.utils.ts` or `.util.ts`
- Keep functions pure where possible — no side effects
- Security-sensitive utilities (URL validation, file type checking) should block dangerous inputs by default
- External dependencies are allowed but should be minimal — currently uses `date-fns-tz` for timezone operations

### Validators (`validators/`)

Reusable Angular reactive form validators grouped by domain (meetings, mailing lists, votes).

**Conventions:**

- File suffix: `.validators.ts`
- Export as a static class (e.g., `MeetingValidators.validTitle`)
- Import from `@lfx-one/shared/validators`

## Adding New Items

1. **Create or find the domain file** in the appropriate subdirectory
2. **Add your interface/constant/enum/utility** following the naming conventions above
3. **Export from the barrel** — add to the subdirectory's `index.ts`
4. **Use in your code** — import from the category path (e.g., `@lfx-one/shared/interfaces`)

No package rebuild needed during development — path mappings resolve directly to source.

## Dependencies

The shared package has minimal runtime dependencies to avoid version conflicts:

- **`date-fns` / `date-fns-tz`**: Timezone-aware date operations in `date-time.utils.ts`
- **Peer dependencies**: `@angular/forms` (for validators and form utils), `@fullcalendar/core`, `chart.js`, `snowflake-sdk` (types only)

Keep runtime dependencies minimal. Prefer peer dependencies for framework-specific types.

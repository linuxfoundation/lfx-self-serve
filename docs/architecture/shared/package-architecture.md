# Package Architecture

## Overview

The `@lfx-one/shared` package centralizes types, constants, utilities, enums, and validators used across the monorepo. It is the single source of truth for shared contracts between the Angular app (`apps/lfx-one`) and the Express SSR server.

## Package Organization

```text
packages/shared/src/
├── interfaces/       # TypeScript interfaces (.interface.ts suffix, one domain per file)
├── constants/        # Design tokens, API config, domain constants (.constants.ts)
├── enums/            # Shared string enumerations (.enum.ts)
├── utils/            # Pure utility functions, generic + domain-specific (.utils.ts / .util.ts)
├── validators/       # Angular reactive form validators (.validators.ts)
└── index.ts          # Main barrel export
```

Each subdirectory has its own `index.ts` barrel so consumers can import from a category path (`@lfx-one/shared/interfaces`, `@lfx-one/shared/utils`, etc.) without reaching into individual files. The canonical listing of what exists lives in the source tree — read `ls packages/shared/src/<dir>/` rather than chasing a doc enumeration.

## Import Patterns

```typescript
// Category imports — the default style
import { User, AuthContext, MeetingResponse } from '@lfx-one/shared/interfaces';
import { lfxColors, lfxFontSizes } from '@lfx-one/shared/constants';
import { MeetingType, VoteStatus } from '@lfx-one/shared/enums';
import { formatDate, stripHtml, isValidUrl } from '@lfx-one/shared/utils';
import { futureDateTimeValidator, editModeDateTimeValidator } from '@lfx-one/shared/validators';

// Deep imports into a specific file — use only when the category barrel doesn't
// re-export the symbol you need:
import { User } from '@lfx-one/shared/interfaces/auth.interface';
```

During development, TypeScript path mappings resolve `@lfx-one/shared/*` directly to `packages/shared/src/*`, so both the category form and the deep form hot-reload without a rebuild. Production builds go through `tsc` (see Build Process below).

## What Goes Where

### Interfaces (`interfaces/`)

All TypeScript interfaces live in this package — **including component-specific prop interfaces** — so types are discoverable from one place and reusable without refactoring.

- File suffix: `.interface.ts`; one domain per file (e.g. `meeting.interface.ts` owns all meeting-shaped types).
- Prefer `interface` over union types where it makes the shape extensible.
- Add JSDoc for non-obvious fields (especially ones that mirror upstream Go/Goa API shapes).

### Constants (`constants/`)

Design tokens, API endpoint config, and static lookup data (countries, timezones, t-shirt sizes, etc.).

- Use `as const` assertions for immutable values.
- Group by domain file. Subdirectories are allowed for large groupings (e.g. `meeting-templates/`).

### Enums (`enums/`)

Shared enumerations used on both sides of the wire.

- File suffix: `.enum.ts`.
- Prefer string enums so values are readable in logs, JSON payloads, and upstream filters.

### Utilities (`utils/`)

Pure functions, split into two groups:

- **Generic** — domain-free helpers: date/time formatting (timezone-aware via `date-fns-tz`), string manipulation, URL parsing, file type detection, HTML sanitization, Angular form helpers, color math.
- **Domain-specific** — helpers tied to a feature shape: meeting transformations and RSVP calculations, poll/vote/survey status derivation, project context helpers, committee/badge/reward logic, insights URL builders, marketing/flywheel computations, etc.

Conventions:

- File suffix: `.utils.ts` (or `.util.ts` for older single-purpose files).
- Keep functions pure — no side effects, no I/O.
- Security-sensitive utilities (URL validation, file type checking) should block dangerous inputs by default.
- Keep runtime dependencies minimal. Currently only `date-fns` + `date-fns-tz` are runtime deps.

### Validators (`validators/`)

Reusable Angular reactive form validators, one file per domain.

- File suffix: `.validators.ts`.
- Export as standalone `ValidatorFn` functions (one per rule), grouped by domain in the file.
- Import path: `@lfx-one/shared/validators`.

```typescript
import { futureDateTimeValidator, editModeDateTimeValidator, voteOptionValidator } from '@lfx-one/shared/validators';
```

## Adding New Items

1. Find or create the right domain file in the appropriate subdirectory (e.g. `interfaces/meeting.interface.ts`).
2. Add the interface, constant, enum, util, or validator following the conventions above.
3. Export from that subdirectory's `index.ts` barrel.
4. Import via the category path (`@lfx-one/shared/interfaces`) from consuming code.

No rebuild is needed during development — path mappings resolve directly to source.

## Build Process

The package is built with plain `tsc` (no bundler). Outputs declarations alongside JS for downstream workspace consumers.

```bash
# From the repo root
yarn build           # builds everything including @lfx-one/shared
yarn check-types     # type-check only, no emit

# Or scoped
yarn workspace @lfx-one/shared build
yarn workspace @lfx-one/shared check-types
```

TypeScript targets ES2022 with strict mode and `moduleResolution: "bundler"`; see `packages/shared/tsconfig.json` for the canonical config.

## Dependencies

- **Runtime** (within `packages/shared/`): `date-fns`, `date-fns-tz` — the only runtime deps inside the shared package. Other repo-wide runtime deps live in the root `package.json`.
- **Peer**: `@angular/core`, `@angular/forms`, `rxjs`, `@fullcalendar/core`, `chart.js`, `snowflake-sdk` — see `packages/shared/package.json` for the canonical list and version ranges.

Keep runtime deps minimal. Prefer peer dependencies for framework-specific types so consumers control the version.

## Best Practices

- **File naming**: Use the canonical suffix (`.interface.ts`, `.constants.ts`, `.enum.ts`, `.utils.ts`, `.validators.ts`) so tooling and grep work consistently.
- **Interfaces everywhere**: Even component-specific prop types live here — no local `interface Foo {}` declarations inside `apps/lfx-one/`.
- **Prefer `interface` over union types** for shapes you might extend.
- **Optional properties**: Use `?` for fields that may be undefined rather than `| undefined` in unions.
- **Pure utils**: Utilities should not import from `apps/lfx-one/` — the dependency direction is one-way (app depends on shared, not vice versa).

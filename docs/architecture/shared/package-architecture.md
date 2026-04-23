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

## Detailed Directory Structure

```text
packages/shared/
├── src/
│   ├── interfaces/                    # 30 TypeScript interface files
│   │   ├── access-check.interface.ts  # Permission/access check types
│   │   ├── account.interface.ts       # Account/organization types
│   │   ├── ai.interface.ts            # AI service types
│   │   ├── analytics-data.interface.ts # Analytics data models
│   │   ├── api.interface.ts           # API request/response types
│   │   ├── auth.interface.ts          # Authentication types (User, AuthContext, M2M, RouteAuthConfig)
│   │   ├── calendar.interface.ts      # Calendar/FullCalendar types
│   │   ├── committee.interface.ts     # Committee data models
│   │   ├── components.interface.ts    # Component prop interfaces (Avatar, etc.)
│   │   ├── dashboard-metric.interface.ts # Dashboard metric types
│   │   ├── filter.interface.ts        # Filter/search filter types
│   │   ├── mailing-list.interface.ts  # Mailing list data models
│   │   ├── meeting-attachment.interface.ts # Meeting attachment types
│   │   ├── meeting.interface.ts       # Meeting data models
│   │   ├── member.interface.ts        # Member/membership types
│   │   ├── organization.interface.ts  # Organization data models
│   │   ├── permissions.interface.ts   # Permission types
│   │   ├── persona.interface.ts       # User persona types
│   │   ├── poll.interface.ts          # Poll/voting types
│   │   ├── profile.interface.ts       # User profile types
│   │   ├── project.interface.ts       # Project data models
│   │   ├── runtime-config.interface.ts # Runtime configuration types
│   │   ├── search.interface.ts        # Search types
│   │   ├── segment.interface.ts       # Analytics segment types
│   │   ├── snowflake.interface.ts     # Snowflake query types
│   │   ├── survey.interface.ts        # Survey data models
│   │   ├── user-profile.interface.ts  # Extended user profile types
│   │   ├── user-statistics.interface.ts # User statistics types
│   │   └── index.ts                   # Interface exports
│   ├── constants/                     # 30 constant files
│   │   ├── accounts.constants.ts      # Account-related constants
│   │   ├── action-items.constants.ts  # Action item constants
│   │   ├── ai.constants.ts            # AI configuration constants
│   │   ├── analytics.constants.ts     # Analytics constants
│   │   ├── api.constants.ts           # API endpoint constants
│   │   ├── chart-options.constants.ts # Chart.js configuration
│   │   ├── colors.constants.ts        # LFX brand colors
│   │   ├── committees.constants.ts    # Committee constants
│   │   ├── cookie.constants.ts        # Cookie configuration
│   │   ├── countries.constants.ts     # Country list
│   │   ├── dashboard-metrics.constants.ts # Dashboard metric definitions
│   │   ├── file-upload.constants.ts   # File upload constraints
│   │   ├── font-sizes.constants.ts    # Typography scales
│   │   ├── mailing-list.constants.ts  # Mailing list constants
│   │   ├── meeting-templates/         # Meeting template data
│   │   ├── meeting.constants.ts       # Meeting constants
│   │   ├── persona.constants.ts       # Persona configuration
│   │   ├── poll.constants.ts          # Poll/vote constants
│   │   ├── primeng-theme.constants.ts # PrimeNG theme configuration
│   │   ├── profile.constants.ts       # Profile constants
│   │   ├── server.constants.ts        # Server-side constants
│   │   ├── snowflake.constant.ts      # Snowflake configuration
│   │   ├── states.constants.ts        # US states list
│   │   ├── survey.constants.ts        # Survey constants
│   │   ├── tag.constants.ts           # Tag constants
│   │   ├── timezones.constants.ts     # Timezone definitions
│   │   ├── tshirt-sizes.constants.ts  # T-shirt size options
│   │   ├── typography.constants.ts    # Typography constants
│   │   ├── validation.constants.ts    # Validation rules
│   │   └── index.ts                   # Constant exports
│   ├── enums/                         # 10 shared enumerations
│   │   ├── committee-member.enum.ts   # Committee member roles
│   │   ├── committee.enum.ts          # Committee types/categories
│   │   ├── error.enum.ts              # Error codes
│   │   ├── mailing-list.enum.ts       # Mailing list types
│   │   ├── meeting.enum.ts            # Meeting statuses/types
│   │   ├── nats.enum.ts               # NATS subjects
│   │   ├── poll.enum.ts               # Poll statuses
│   │   ├── snowflake.enum.ts          # Snowflake query types
│   │   ├── survey.enum.ts             # Survey statuses
│   │   └── index.ts                   # Enum exports
│   ├── utils/                         # 12 utility modules
│   │   ├── color.utils.ts             # Color manipulation (hexToRgba, toHslaValue)
│   │   ├── date-time.utils.ts         # Date formatting, timezone handling
│   │   ├── file.utils.ts              # File type detection
│   │   ├── form.utils.ts              # Angular form helpers
│   │   ├── html-utils.ts              # HTML sanitization
│   │   ├── meeting.utils.ts           # Meeting data transformations
│   │   ├── poll.utils.ts              # Poll status utilities
│   │   ├── rsvp-calculator.util.ts    # RSVP statistics
│   │   ├── string.utils.ts            # String manipulation
│   │   ├── survey.utils.ts            # Survey data processing
│   │   ├── url.utils.ts               # URL parsing and construction
│   │   ├── vote.utils.ts              # Vote data utilities
│   │   └── index.ts                   # Utility exports
│   ├── validators/                    # 3 form validators
│   │   ├── mailing-list.validators.ts # Mailing list form validators
│   │   ├── meeting.validators.ts      # Meeting form validators
│   │   ├── vote.validators.ts         # Vote form validators
│   │   └── index.ts                   # Validator exports
│   └── index.ts                       # Main package export
├── package.json                       # Package configuration
└── tsconfig.json                      # TypeScript configuration
```

## Package Configuration

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

// Direct source imports (for development hot reloading)
import { User } from '@lfx-one/shared/src/interfaces/auth.interface';
```

During development, the monorepo uses direct source imports (via TypeScript path mappings) for hot reloading -- no need to rebuild the shared package after changes.

## What Goes Where

### Interfaces (`interfaces/`)

All TypeScript interfaces live here -- even component-specific ones. This ensures consistent type definitions and makes types discoverable.

**Conventions:**

- File suffix: `.interface.ts` (e.g., `meeting.interface.ts`)
- One domain per file -- group related interfaces together
- Export from the barrel `index.ts`
- Use `interface` over `type` unions for better maintainability
- Add JSDoc comments for non-obvious properties

### Key Interfaces

#### Authentication (`auth.interface.ts`)

```typescript
export interface User {
  sid: string;
  'https://sso.linuxfoundation.org/claims/username': string;
  given_name: string;
  family_name: string;
  nickname: string;
  name: string;
  picture: string;
  updated_at: string;
  email: string;
  email_verified: boolean;
  sub: string;
}

export interface AuthContext {
  authenticated: boolean;
  user: User | null;
  persona?: PersonaType | null;
  organizations?: Account[];
}
```

Also includes: `M2MTokenResponse`, `BearerTokenOptions`, `RouteAuthConfig`, `AuthDecision`, `TokenExtractionResult`, `AuthMiddlewareResult`, `AuthConfig`

#### Component Interfaces (`components.interface.ts`)

```typescript
export interface AvatarProps {
  label?: string;
  icon?: string;
  image?: string;
  size?: 'large' | 'xlarge' | 'normal';
  shape?: 'square' | 'circle';
  style?: Record<string, string | number> | null;
  styleClass?: string;
  ariaLabel?: string;
}
```

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
- Keep functions pure where possible -- no side effects
- Security-sensitive utilities (URL validation, file type checking) should block dangerous inputs by default
- External dependencies are allowed but should be minimal -- currently uses `date-fns-tz` for timezone operations

#### Generic Utilities

| Module               | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `color.utils.ts`     | Color manipulation (`hexToRgba`, `toHslaValue`)                                    |
| `date-time.utils.ts` | Date formatting, timezone handling (`formatDate`, `formatTime`, `getRelativeDate`) |
| `file.utils.ts`      | File type detection (`getFileType`, `getFileExtension`)                            |
| `form.utils.ts`      | Angular form helpers (`markFormControlsAsTouched`)                                 |
| `html-utils.ts`      | HTML sanitization (`stripHtml`)                                                    |
| `string.utils.ts`    | String manipulation (`parseToInt`, `truncate`)                                     |
| `url.utils.ts`       | URL parsing and construction (`buildUrl`, `parseQueryParams`)                      |

#### Domain-Specific Utilities

| Module                    | Description                                                                 |
| ------------------------- | --------------------------------------------------------------------------- |
| `meeting.utils.ts`        | Meeting data transformations (`transformV1MeetingToV2`, `getMeetingStatus`) |
| `poll.utils.ts`           | Poll status utilities (`getPollStatus`)                                     |
| `rsvp-calculator.util.ts` | RSVP statistics calculation                                                 |
| `survey.utils.ts`         | Survey data processing (`calculateNpsScore`, `getSurveyStatus`)             |
| `vote.utils.ts`           | Vote data utilities                                                         |

### Validators (`validators/`)

Reusable Angular reactive form validators grouped by domain (meetings, mailing lists, votes).

**Conventions:**

- File suffix: `.validators.ts`
- Export as a static class (e.g., `MeetingValidators.validTitle`)
- Import from `@lfx-one/shared/validators`

```typescript
import { MeetingValidators } from '@lfx-one/shared/validators';
import { MailingListValidators } from '@lfx-one/shared/validators';
import { VoteValidators } from '@lfx-one/shared/validators';
```

- **`meeting.validators.ts`** - Meeting form validators (title, duration, time range)
- **`mailing-list.validators.ts`** - Mailing list form validators (name, email)
- **`vote.validators.ts`** - Vote form validators (question, options count, deadline)

## Adding New Items

1. **Create or find the domain file** in the appropriate subdirectory
2. **Add your interface/constant/enum/utility** following the naming conventions above
3. **Export from the barrel** -- add to the subdirectory's `index.ts`
4. **Use in your code** -- import from the category path (e.g., `@lfx-one/shared/interfaces`)

No package rebuild needed during development -- path mappings resolve directly to source.

## Build Process

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

### Build Commands

```bash
# Build the shared package
cd packages/shared && yarn build

# Watch for changes
cd packages/shared && yarn watch

# Type checking only
cd packages/shared && yarn check-types
```

## Dependencies

The shared package has minimal runtime dependencies to avoid version conflicts:

- **`date-fns` / `date-fns-tz`**: Timezone-aware date operations in `date-time.utils.ts`
- **Peer dependencies**: `@angular/forms` (for validators and form utils), `@fullcalendar/core`, `chart.js`, `snowflake-sdk` (types only)

Keep runtime dependencies minimal. Prefer peer dependencies for framework-specific types.

## Best Practices

### Interface Design

- **File naming**: Use `.interface.ts` suffix for all interface files
- **Shared location**: All interfaces go in `@lfx-one/shared/interfaces`, even component-specific ones
- **Optional properties**: Use `?` for properties that may be undefined
- **TypeScript interfaces over union types**: Better maintainability

# Package Architecture

## Shared Package Structure

The `@lfx-one/shared` package provides common interfaces, constants, enums, utilities, and validators used across the monorepo.

## Directory Structure

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
│   │   ├── my-activity.interface.ts   # User activity types
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
│   │   ├── my-activity.constants.ts   # Activity tracking constants
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

### Package.json Exports

```json
{
  "name": "@lfx-one/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./interfaces": {
      "types": "./dist/interfaces/index.d.ts",
      "import": "./dist/interfaces/index.js",
      "require": "./dist/interfaces/index.js",
      "default": "./dist/interfaces/index.js"
    },
    "./enums": {
      "types": "./dist/enums/index.d.ts",
      "import": "./dist/enums/index.js",
      "require": "./dist/enums/index.js",
      "default": "./dist/enums/index.js"
    },
    "./constants": {
      "types": "./dist/constants/index.d.ts",
      "import": "./dist/constants/index.js",
      "require": "./dist/constants/index.js",
      "default": "./dist/constants/index.js"
    },
    "./validators": {
      "types": "./dist/validators/index.d.ts",
      "import": "./dist/validators/index.js",
      "require": "./dist/validators/index.js",
      "default": "./dist/validators/index.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  }
}
```

### Import Patterns

```typescript
// Main export (all interfaces, constants, enums)
import { User, AuthContext, AvatarProps } from '@lfx-one/shared';

// Specific sub-path exports
import { User, AuthContext } from '@lfx-one/shared/interfaces';
import { lfxColors } from '@lfx-one/shared/constants';
import { MeetingStatus } from '@lfx-one/shared/enums';
import { formatDate, getRelativeDate } from '@lfx-one/shared/utils';
import { MeetingValidators } from '@lfx-one/shared/validators';

// Direct source imports (for development hot reloading)
import { User } from '@lfx-one/shared/src/interfaces/auth.interface';
```

## Interface Architecture

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

### Interface File Naming Convention

All interface files use the `.interface.ts` suffix:

- `auth.interface.ts` (not `auth.ts`)
- `meeting.interface.ts` (not `meeting.ts`)
- `project.interface.ts` (not `project.ts`)

## Constants Architecture

### Design Tokens

```typescript
// colors.constants.ts - LFX brand colors used in Tailwind config
import { lfxColors } from '@lfx-one/shared/constants';

// font-sizes.constants.ts - Typography scales used in Tailwind config
import { lfxFontSizes } from '@lfx-one/shared/constants';
```

### Domain Constants

Constants are organized by domain (meetings, committees, surveys, polls, etc.) and include configuration values, status labels, validation rules, and reference data (countries, timezones, states).

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

## Package Dependencies

### Runtime Dependencies

```json
{
  "dependencies": {
    "date-fns": "^4.1.0",
    "date-fns-tz": "^3.2.0"
  }
}
```

### Peer Dependencies

```json
{
  "peerDependencies": {
    "@angular/forms": "^20.3.15",
    "@fullcalendar/core": "^6.1.19",
    "chart.js": "^4.5.0",
    "snowflake-sdk": "^2.3.1"
  }
}
```

### Development Dependencies

```json
{
  "devDependencies": {
    "@fullcalendar/core": "^6.1.19",
    "typescript": "5.8.3"
  }
}
```

## Utilities

The shared package provides 12 utility modules for common operations. See [CLAUDE.md Shared Package Utilities](../../CLAUDE.md#shared-package-utilities) for usage examples.

### Generic Utilities

| Module               | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `color.utils.ts`     | Color manipulation (`hexToRgba`, `toHslaValue`)                                    |
| `date-time.utils.ts` | Date formatting, timezone handling (`formatDate`, `formatTime`, `getRelativeDate`) |
| `file.utils.ts`      | File type detection (`getFileType`, `getFileExtension`)                            |
| `form.utils.ts`      | Angular form helpers (`markFormControlsAsTouched`)                                 |
| `html-utils.ts`      | HTML sanitization (`stripHtml`)                                                    |
| `string.utils.ts`    | String manipulation (`parseToInt`, `truncate`)                                     |
| `url.utils.ts`       | URL parsing and construction (`buildUrl`, `parseQueryParams`)                      |

### Domain-Specific Utilities

| Module                    | Description                                                                 |
| ------------------------- | --------------------------------------------------------------------------- |
| `meeting.utils.ts`        | Meeting data transformations (`transformV1MeetingToV2`, `getMeetingStatus`) |
| `poll.utils.ts`           | Poll status utilities (`getPollStatus`)                                     |
| `rsvp-calculator.util.ts` | RSVP statistics calculation                                                 |
| `survey.utils.ts`         | Survey data processing (`calculateNpsScore`, `getSurveyStatus`)             |
| `vote.utils.ts`           | Vote data utilities                                                         |

## Validators

The shared package provides 3 form validator modules for Angular reactive forms.

```typescript
import { MeetingValidators } from '@lfx-one/shared/validators';
import { MailingListValidators } from '@lfx-one/shared/validators';
import { VoteValidators } from '@lfx-one/shared/validators';
```

- **`meeting.validators.ts`** - Meeting form validators (title, duration, time range)
- **`mailing-list.validators.ts`** - Mailing list form validators (name, email)
- **`vote.validators.ts`** - Vote form validators (question, options count, deadline)

## Best Practices

### Interface Design

- **File naming**: Use `.interface.ts` suffix for all interface files
- **Shared location**: All interfaces go in `@lfx-one/shared/interfaces`, even component-specific ones
- **Optional properties**: Use `?` for properties that may be undefined
- **TypeScript interfaces over union types**: Better maintainability

### Adding New Content

1. Create the file in the appropriate directory (`interfaces/`, `constants/`, `enums/`, `utils/`, `validators/`)
2. Export from the directory's `index.ts`
3. Build the package (`yarn build` from `packages/shared/`)
4. Import using the sub-path export pattern (`@lfx-one/shared/interfaces`)

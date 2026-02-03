# Package Architecture

## 📦 Shared Package Structure

The `@lfx-one/shared` package provides common interfaces, constants, and utilities used across the monorepo.

## 🏗 Directory Structure

```text
packages/shared/
├── src/
│   ├── interfaces/          # TypeScript interfaces
│   │   ├── auth.ts         # Authentication types
│   │   ├── components.ts   # Component prop interfaces
│   │   ├── project.ts      # Project data models
│   │   └── index.ts        # Interface exports
│   ├── constants/          # Application constants
│   │   ├── colors.ts       # LFX brand colors
│   │   ├── font-sizes.ts   # Typography scales
│   │   └── index.ts        # Constant exports
│   ├── enums/             # TypeScript enums
│   │   └── index.ts       # Enum exports
│   └── index.ts           # Main package export
├── package.json           # Package configuration
└── tsconfig.json         # TypeScript configuration
```

## 📋 Package Configuration

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
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./interfaces": {
      "import": "./dist/interfaces/index.js",
      "types": "./dist/interfaces/index.d.ts"
    },
    "./enums": {
      "import": "./dist/enums/index.js",
      "types": "./dist/enums/index.d.ts"
    },
    "./constants": {
      "import": "./dist/constants/index.js",
      "types": "./dist/constants/index.d.ts"
    }
  }
}
```

### Multiple Export Patterns

The package supports multiple import patterns for flexibility:

```typescript
// Main export (all interfaces)
import { User, AuthContext, AvatarProps } from '@lfx-one/shared';

// Specific exports
import { User, AuthContext } from '@lfx-one/shared/interfaces';
import { lfxColors } from '@lfx-one/shared/constants';
```

## 🔧 Interface Architecture

### Authentication Interfaces

```typescript
// packages/shared/src/interfaces/auth.ts
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
}
```

### Component Interfaces

```typescript
// packages/shared/src/interfaces/components.ts
export interface AvatarSizeOptions {
  size: 'large' | 'xlarge' | 'normal';
}

export interface AvatarShapeOptions {
  shape: 'square' | 'circle';
}

export interface AvatarProps {
  label?: string;
  icon?: string;
  image?: string;
  size?: AvatarSizeOptions['size'];
  shape?: AvatarShapeOptions['shape'];
  style?: Record<string, string | number> | null;
  styleClass?: string;
  ariaLabel?: string;
}
```

### Project Interfaces

```typescript
// packages/shared/src/interfaces/project.ts
export interface Project {
  id: string;
  name: string;
  description: string;
  // Additional project fields as implemented
}
```

## 🎨 Constants Architecture

### Color System

```typescript
// packages/shared/src/constants/colors.ts
export const lfxColors = {
  primary: {
    50: '#eff6ff',
    100: '#dbeafe',
    // ... full color scale
    900: '#1e3a8a',
  },
  // Additional color scales
};
```

### Typography Constants

```typescript
// packages/shared/src/constants/font-sizes.ts
export const lfxFontSizes = {
  '2xs': ['0.625rem', { lineHeight: '0.75rem' }],
  xs: ['0.75rem', { lineHeight: '1rem' }],
  // ... additional font sizes
};
```

## 📤 Export Strategy

### Main Index Export

```typescript
// packages/shared/src/index.ts
// Export all interfaces
export * from './interfaces';

// Export all constants
export * from './constants';

// Export all enums
export * from './enums';
```

### Category-Specific Exports

```typescript
// packages/shared/src/interfaces/index.ts
export * from './project';
export * from './components';
export * from './auth';
```

## 🔄 Build Process

### TypeScript Compilation

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist"
  }
}
```

### Build Commands

```bash
# Build the shared package
cd packages/shared
npm run build

# Watch for changes
npm run watch

# Type checking only
npm run check-types
```

## 🎯 Usage Patterns

### Frontend Usage

```typescript
// Angular component
import { User, AvatarProps } from '@lfx-one/shared/interfaces';
import { lfxColors } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-user-card',
  template: `...`,
})
export class UserCardComponent {
  @Input() user: User;
  @Input() avatarProps: AvatarProps;
}
```

### Backend Usage

```typescript
// Express server
import { User, AuthContext } from '@lfx-one/shared/interfaces';

app.use('/**', (req: Request, res: Response, next: NextFunction) => {
  const auth: AuthContext = {
    authenticated: false,
    user: null,
  };

  if (req.oidc?.isAuthenticated()) {
    auth.authenticated = true;
    auth.user = req.oidc?.user as User;
  }

  // ... rest of handler
});
```

## 🔧 Development Workflow

### Adding New Interfaces

1. Create interface file in appropriate category
2. Export from category index file
3. Add to main index if needed
4. Build the package
5. Use in applications

### Type Safety Benefits

- **Compile-time Validation**: TypeScript catches type mismatches
- **IDE Support**: IntelliSense and auto-completion
- **Refactoring Safety**: Rename/change detection across projects
- **API Consistency**: Shared interfaces ensure consistent data structures

## 📊 Package Dependencies

### Development Dependencies

```json
{
  "devDependencies": {
    "typescript": "5.8.3"
  }
}
```

### Runtime Dependencies

The shared package has no runtime dependencies to avoid version conflicts.

## 🔄 Version Management

### Semantic Versioning

- **Major**: Breaking interface changes
- **Minor**: New interfaces or optional properties
- **Patch**: Bug fixes or documentation updates

### Dependency Updates

When shared package changes:

1. Build the shared package
2. Update dependent applications
3. Test integration
4. Deploy applications

## 🎯 Best Practices

### Interface Design

- **Immutable by Design**: Use readonly properties where appropriate
- **Optional Properties**: Make optional what can be undefined
- **Descriptive Names**: Use clear, descriptive interface names
- **Documentation**: Add JSDoc comments for complex interfaces

### Export Strategy

- **Granular Exports**: Allow importing specific categories
- **Barrel Exports**: Provide convenient main export
- **Type-Only Exports**: Use when appropriate to reduce bundle size

### Breaking Changes

- **Deprecation**: Mark old interfaces as deprecated
- **Migration Path**: Provide clear migration instructions
- **Version Bump**: Use major version for breaking changes

This shared package architecture provides a solid foundation for type-safe, maintainable code sharing across the monorepo.

## 🛠 Utilities

The shared package provides utility functions for common operations across the application.

### Directory Structure

```text
packages/shared/src/utils/
├── color.utils.ts          # Color manipulation functions
├── date-time.utils.ts      # Date formatting and timezone handling
├── file.utils.ts           # File type detection and validation
├── form.utils.ts           # Form helpers
├── html-utils.ts           # HTML sanitization
├── meeting.utils.ts        # Meeting data transformations
├── poll.utils.ts           # Poll status utilities
├── rsvp-calculator.util.ts # RSVP calculations
├── string.utils.ts         # String manipulation
├── survey.utils.ts         # Survey data utilities
└── url.utils.ts            # URL parsing and construction
```

### Color Utilities (`color.utils.ts`)

Functions for color manipulation and conversion:

```typescript
import { hexToRgba, toHslaValue } from '@lfx-one/shared/utils';

// Convert hex color to RGBA with opacity
const rgba = hexToRgba('#3B82F6', 0.5); // 'rgba(59, 130, 246, 0.5)'

// Convert color to HSLA value
const hsla = toHslaValue('#3B82F6');
```

### Date-Time Utilities (`date-time.utils.ts`)

Comprehensive date and time handling with timezone support (17 functions):

```typescript
import {
  formatDate,
  formatTime,
  formatDateTime,
  getRelativeDate,
  convertToTimezone,
  getTimezoneOffset,
  isSameDay,
  isToday,
  isPast,
  isFuture,
} from '@lfx-one/shared/utils';

// Format dates consistently across the application
const formattedDate = formatDate(new Date(), 'MMM d, yyyy');
const formattedTime = formatTime(new Date(), 'h:mm a');

// Get relative date text
const relative = getRelativeDate(new Date('2024-01-01')); // "3 months ago"

// Timezone conversions
const converted = convertToTimezone(date, 'America/New_York');
```

### File Utilities (`file.utils.ts`)

File type detection and validation:

```typescript
import { getFileType, isValidFileType, getFileExtension } from '@lfx-one/shared/utils';

// Detect file type
const fileType = getFileType('document.pdf'); // 'pdf'

// Validate file type against allowed types
const isValid = isValidFileType(file, ['pdf', 'docx', 'xlsx']);
```

### Form Utilities (`form.utils.ts`)

Angular reactive form helpers:

```typescript
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';

// Mark all form controls as touched for validation display
markFormControlsAsTouched(this.myForm);
```

### HTML Utilities (`html-utils.ts`)

HTML sanitization functions:

```typescript
import { stripHtml } from '@lfx-one/shared/utils';

// Remove HTML tags from string
const plainText = stripHtml('<p>Hello <strong>World</strong></p>'); // "Hello World"
```

### Meeting Utilities (`meeting.utils.ts`)

Meeting data transformations (9 functions):

```typescript
import { transformV1MeetingToV2, getMeetingStatus, getMeetingDuration, formatMeetingTime, isRecurringMeeting, getNextOccurrence } from '@lfx-one/shared/utils';

// Transform legacy meeting format
const v2Meeting = transformV1MeetingToV2(v1Meeting);

// Get meeting status
const status = getMeetingStatus(meeting); // 'upcoming' | 'in-progress' | 'completed'
```

### Poll Utilities (`poll.utils.ts`)

Poll status management:

```typescript
import { getPollStatus, calculatePollResults } from '@lfx-one/shared/utils';

// Get current poll status
const status = getPollStatus(poll); // 'draft' | 'active' | 'closed'
```

### RSVP Calculator (`rsvp-calculator.util.ts`)

RSVP calculations for meetings:

```typescript
import { calculateRsvpStats, getRsvpSummary } from '@lfx-one/shared/utils';

// Calculate RSVP statistics
const stats = calculateRsvpStats(rsvps);
// { attending: 15, notAttending: 3, tentative: 2, noResponse: 5 }
```

### String Utilities (`string.utils.ts`)

String manipulation helpers:

```typescript
import { parseToInt, truncate, capitalize } from '@lfx-one/shared/utils';

// Parse string to integer safely
const num = parseToInt('42', 0); // 42
const fallback = parseToInt('invalid', 0); // 0
```

### Survey Utilities (`survey.utils.ts`)

Survey data processing:

```typescript
import { calculateNpsScore, getSurveyStatus } from '@lfx-one/shared/utils';

// Calculate NPS score from responses
const nps = calculateNpsScore(responses);
```

### URL Utilities (`url.utils.ts`)

URL parsing and construction:

```typescript
import { buildUrl, parseQueryParams, appendQueryParam } from '@lfx-one/shared/utils';

// Build URL with query parameters
const url = buildUrl('/api/meetings', { page: 1, limit: 10 });
// '/api/meetings?page=1&limit=10'
```

## ✅ Validators

The shared package provides reusable form validators for Angular reactive forms.

### Directory Structure

```text
packages/shared/src/validators/
├── mailing-list.validators.ts  # Mailing list form validators
├── meeting.validators.ts       # Meeting form validators
└── vote.validators.ts          # Vote form validators
```

### Mailing List Validators (`mailing-list.validators.ts`)

```typescript
import { MailingListValidators } from '@lfx-one/shared/validators';

this.form = this.fb.group({
  name: ['', [Validators.required, MailingListValidators.validName]],
  email: ['', [Validators.required, MailingListValidators.validEmail]],
  description: ['', [MailingListValidators.maxLength(500)]],
});
```

### Meeting Validators (`meeting.validators.ts`)

```typescript
import { MeetingValidators } from '@lfx-one/shared/validators';

this.form = this.fb.group(
  {
    title: ['', [Validators.required, MeetingValidators.validTitle]],
    startTime: ['', [Validators.required]],
    endTime: ['', [Validators.required]],
    duration: ['', [MeetingValidators.validDuration]],
  },
  {
    validators: [MeetingValidators.endTimeAfterStartTime],
  }
);
```

### Vote Validators (`vote.validators.ts`)

```typescript
import { VoteValidators } from '@lfx-one/shared/validators';

this.form = this.fb.group({
  question: ['', [Validators.required, VoteValidators.validQuestion]],
  options: this.fb.array([], [VoteValidators.minOptions(2), VoteValidators.maxOptions(10)]),
  deadline: ['', [Validators.required, VoteValidators.futureDate]],
});
```

## 📁 Meeting Templates

The shared package includes meeting template structures for consistent meeting creation.

### Directory Structure

```text
packages/shared/src/meeting-templates/
├── templates/              # Pre-defined meeting templates
│   ├── standup.ts         # Daily standup template
│   ├── retrospective.ts   # Sprint retrospective template
│   └── planning.ts        # Sprint planning template
├── interfaces/            # Template type definitions
└── index.ts               # Template exports
```

### Usage

```typescript
import { MeetingTemplates, MeetingTemplateType } from '@lfx-one/shared/meeting-templates';

// Get a pre-defined template
const standupTemplate = MeetingTemplates.get(MeetingTemplateType.Standup);

// Apply template to meeting form
this.meetingForm.patchValue(standupTemplate.defaults);
```

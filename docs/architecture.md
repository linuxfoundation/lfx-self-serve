# Architecture Documentation

## 🏗 System Architecture

### Backend Stack

- **PostgreSQL 15**: Primary database with Row Level Security (RLS)
- **PostgREST**: Auto-generated REST API from PostgreSQL schema
- **Express.js**: BFF (Backend-For-Frontend) server with SSR, authentication, and AI services
- **Auth0**: Authentication provider with OpenID Connect
- **Pino**: Structured JSON logging with sensitive data redaction
- **Docker**: Containerized PostgreSQL with custom extensions
- **Database Triggers**: Webhook system for Slack notifications

### Frontend Stack

- **Angular 19**: Modern Angular with experimental zoneless change detection and SSR
- **Angular Signals**: Reactive state management (preferred over RxJS for simple data)
- **PrimeNG 19**: UI components with custom LFX UI Core preset and Tailwind CSS integration
- **Tailwind CSS v3**: Utility-first styling framework with PrimeUI plugin
- **LFX UI Core**: Linux Foundation design system integration
- **LFX Tools**: Web component for platform navigation integration
- **Font Awesome Pro**: Icon library via kits (no npm packages)
- **Google Fonts**: Open Sans (primary) and Roboto Slab (display) fonts

## ⚡ Zoneless Change Detection

Angular 19 introduces experimental zoneless change detection, which this application uses for improved performance:

### Configuration

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
    provideAnimationsAsync(),
    // ... other providers
  ],
};
```

### Key Benefits

- **No Zone.js dependency**: Reduces bundle size and improves startup performance
- **Better performance**: Manual change detection triggering when needed
- **Signal-first**: Encourages use of Angular Signals for reactive programming
- **Future-ready**: Prepares codebase for Angular's direction

### Implications for Development

1. **Use Angular Signals** for state management instead of RxJS for simple data
2. **Manual change detection** may be needed for some third-party integrations
3. **Testing adjustments** may be required for components that rely on automatic change detection
4. **Event handling** works as expected with Angular's event system

## 🎨 CSS Layer Architecture

The application uses a sophisticated CSS layer system for optimal styling organization:

### Layer Configuration

```scss
// styles.scss
@layer tailwind-base, primeng, tailwind-utilities;

@layer tailwind-base {
  @tailwind base;
}

@layer tailwind-utilities {
  @tailwind components;
  @tailwind utilities;
}
```

### PrimeNG Integration with CSS Layers

```typescript
// app.config.ts - PrimeNG configuration with CSS layers
providePrimeNG({
  theme: {
    preset: customPreset,
    options: {
      prefix: 'p',
      darkModeSelector: '.dark-mode',
      cssLayer: {
        name: 'primeng',
        order: 'tailwind-base, primeng, tailwind-utilities',
      },
    },
  },
});
```

### Layer Benefits

1. **Proper CSS Cascade**: Ensures Tailwind utilities can override PrimeNG styles
2. **Predictable Specificity**: CSS layers provide consistent style application
3. **Maintainable Architecture**: Clear separation between base styles, component styles, and utilities
4. **Framework Integration**: Seamless integration between Tailwind and PrimeNG

## 🎯 LFX UI Core Integration

The application integrates the Linux Foundation's design system through LFX UI Core:

### Custom PrimeNG Preset

```typescript
// app.config.ts
import { lfxPreset } from '@linuxfoundation/lfx-ui-core';
import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

const customPreset = definePreset(Aura, {
  primitive: lfxPreset.primitive,
  semantic: lfxPreset.semantic,
  components: lfxPreset.component,
});
```

### Design System Benefits

- **Consistent Branding**: Linux Foundation visual identity
- **Accessible Components**: WCAG compliant design patterns
- **Proven Patterns**: Battle-tested UI components
- **Theme Flexibility**: Support for light/dark modes

## 🏗 Service Layer Pattern

All services use **Angular Signals** for state management:

```typescript
@Injectable({ providedIn: 'root' })
export class DataService {
  // Private state signals
  private readonly dataSignal = signal<Data[]>([]);
  private readonly loadingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<string | null>(null);

  // Public readonly signals
  public readonly data = this.dataSignal.asReadonly();
  public readonly loading = this.loadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();

  // Computed signals for derived state
  public readonly activeData = computed(() => this.dataSignal().filter((item) => item.is_active));

  // Methods that update signals
  public updateData(newData: Data[]): void {
    this.dataSignal.set(newData);
  }

  public setLoading(loading: boolean): void {
    this.loadingSignal.set(loading);
  }
}
```

### Signal Patterns

1. **Private Writable Signals**: Internal state management
2. **Public Readonly Signals**: External access to state
3. **Computed Signals**: Derived state from multiple signals
4. **Effect**: Side effects that react to signal changes

## 🎨 Component Architecture

### Development Patterns

- Use **standalone components** with explicit imports
- **Angular Signals** for state (not RxJS for simple data)
- **LFX prefix** for all component selectors (enforced by ESLint)
- **Direct PrimeNG integration** with custom LFX theming
- **Reactive Forms** with proper validation
- **TrackBy functions** for all `@for` loops

### Example Component Structure

```typescript
import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'lfx-example',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, CardModule],
  templateUrl: './example.component.html',
  styleUrl: './example.component.scss',
})
export class ExampleComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(DataService);

  // Use signals from service
  protected readonly loading = this.service.loading;
  protected readonly data = this.service.data;

  // Reactive form
  public readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
  });

  // TrackBy function for loops
  protected readonly trackById = (index: number, item: any) => item.id;
}
```

```html
<!-- example.component.html -->
<p-card header="Example Component" class="mb-4">
  <div class="flex flex-col gap-4">
    <form [formGroup]="form" class="flex flex-col gap-3">
      <input type="text" formControlName="name" placeholder="Name" class="p-2 border rounded" />
      <input type="email" formControlName="email" placeholder="Email" class="p-2 border rounded" />
      <p-button label="Submit" severity="primary" [disabled]="form.invalid" [loading]="loading()"> </p-button>
    </form>

    @if (data().length > 0) {
    <div class="mt-4">
      @for (item of data(); track trackById($index, item)) {
      <p-card [header]="item.name" class="mb-2">
        <p>{{ item.email }}</p>
      </p-card>
      }
    </div>
    }
  </div>
</p-card>
```

### Component Styling Guidelines

```html
<!-- Good: Use Tailwind classes with PrimeNG components -->
<p-card class="mb-6 shadow-lg">
  <div class="flex items-center gap-4 p-4">
    <p-button label="Primary" class="flex-1"></p-button>
    <p-button label="Secondary" severity="secondary" class="flex-1"></p-button>
  </div>
</p-card>

<!-- Good: Pure Tailwind for custom layouts -->
<div class="bg-white rounded-lg shadow-md p-6 mb-4">
  <h2 class="text-2xl font-display font-semibold text-gray-800 mb-4">Title</h2>
  <p class="text-gray-600 leading-relaxed">Content</p>
</div>
```

## 📁 Project Structure

```text
lfx-pcc-v3/
├── apps/
│   └── lfx-pcc/                    # Angular 19 SSR application
│       ├── src/
│       │   ├── app/
│       │   │   ├── app.component.*        # Root component (lfx-root)
│       │   │   ├── app.config.ts          # Application configuration
│       │   │   ├── app.config.server.ts   # SSR configuration
│       │   │   └── app.routes.ts          # Routing configuration
│       │   ├── assets/                    # Static assets
│       │   ├── styles.scss               # Global styles with CSS layers
│       │   ├── index.html                # HTML template
│       │   ├── main.ts                   # Application bootstrap
│       │   ├── main.server.ts            # SSR bootstrap
│       │   └── server/
│       │       └── server.ts             # Express SSR server
│       ├── eslint.config.mjs             # Angular-specific ESLint rules
│       ├── .prettierrc                   # Prettier configuration
│       ├── tailwind.config.js            # Tailwind with PrimeUI plugin
│       ├── tsconfig.json                 # TypeScript configuration
│       ├── tsconfig.app.json             # App-specific TypeScript config
│       └── angular.json                  # Angular CLI configuration
├── packages/
│   └── shared/                           # Shared types, interfaces, constants
│       ├── src/
│       │   ├── interfaces/               # TypeScript interfaces
│       │   │   ├── project.ts            # Project-related interfaces
│       │   │   ├── components.ts         # Component prop interfaces
│       │   │   ├── auth.ts               # Authentication interfaces
│       │   │   └── index.ts              # Interface exports
│       │   ├── constants/                # Design tokens and constants
│       │   │   ├── colors.ts             # LFX brand colors
│       │   │   ├── font-sizes.ts         # Typography scale
│       │   │   └── index.ts              # Constant exports
│       │   ├── enums/                    # Shared enumerations
│       │   │   └── index.ts              # Enum exports
│       │   └── index.ts                  # Main package exports
│       ├── package.json                  # Package configuration
│       └── tsconfig.json                 # TypeScript configuration
├── docs/                                 # Architecture documentation
├── turbo.json                           # Turborepo configuration
├── ecosystem.config.js                  # PM2 production configuration
└── package.json                         # Root workspace configuration
```

## 🎨 Styling & UI System

### Font System

The application uses Google Fonts with CSS custom properties:

```scss
// styles.scss - Font configuration
@import url('https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Roboto+Slab:wght@100..900&display=swap');

@theme {
  /* Open Sans as the primary sans-serif font */
  --font-sans: 'Open Sans', ui-sans-serif, system-ui, sans-serif;

  /* Roboto Slab for headings and display text */
  --font-display: 'Roboto Slab', ui-serif, Georgia, serif;
  --font-serif: 'Roboto Slab', ui-serif, Georgia, serif;
}
```

### Tailwind Configuration

Custom configurations extend the default Tailwind theme:

```typescript
// tailwind.config.js
import PrimeUI from 'tailwindcss-primeui';
import { lfxColors } from './src/app/config/styles/colors';
import { lfxFontSizes } from './src/app/config/styles/font-size';

export default {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: lfxColors,
    },
    fontSize: lfxFontSizes,
    fontFamily: {
      sans: ['Open Sans', 'sans-serif'],
      display: ['Roboto Slab', 'serif'],
      serif: ['Roboto Slab', 'serif'],
    },
  },
  plugins: [PrimeUI],
};
```

### Color System

LFX brand colors with full Tailwind scales:

```typescript
// src/app/config/styles/colors.ts
export const lfxColors = {
  primary: {
    50: '#eff6ff',
    100: '#dbeafe',
    // ... complete scale
    900: '#1e3a8a',
  },
  secondary: {
    // ... complete scale
  },
  // ... more brand colors
};
```

## 🔧 Development Tools

### ESLint Configuration

Angular-specific rules with comprehensive linting:

```javascript
// eslint.config.mjs
export default [
  // TypeScript files
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'lfx',
          style: 'kebab-case',
        },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'lfx',
          style: 'camelCase',
        },
      ],
      // ... more Angular-specific rules
    },
  },
  // Template files
  {
    files: ['**/*.html'],
    extends: ['plugin:@angular-eslint/template/recommended'],
  },
];
```

### Prettier Integration

Code formatting with Tailwind class sorting:

```json
// .prettierrc.js
{
  "plugins": ["prettier-plugin-organize-imports", "prettier-plugin-tailwindcss"],
  "tailwindFunctions": ["clsx", "cn", "tw"],
  "organizeImportsSkipDestructiveCodeActions": true
}
```

### TypeScript Path Mapping

Clean imports with path aliases:

```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@app/*": ["./src/app/*"],
      "@config/*": ["./src/app/config/*"]
    }
  }
}
```

## 🌐 Environment Configuration

### Development Environment

```typescript
// Standard Angular development configuration
export const environment = {
  production: false,
};
```

### Production Environment

```typescript
// Production configuration with optimizations
export const environment = {
  production: true,
};
```

### SSR Configuration

```typescript
// app.config.server.ts
export const config = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering(), provideServerRouting(serverRoutes)],
});
```

### Server Routes Configuration

```typescript
// app.routes.server.ts
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
```

## 🏆 Performance Optimizations

### Zoneless Benefits

- **Reduced bundle size**: No Zone.js dependency
- **Faster startup**: Less framework overhead
- **Better tree shaking**: Cleaner dependency graph
- **Signal optimization**: Framework-native reactivity

### CSS Layer Benefits

- **Optimal loading**: Proper cascade and specificity
- **Better caching**: Separate layer caching strategies
- **Reduced conflicts**: Predictable style application
- **Framework interop**: Seamless Tailwind + PrimeNG integration

### Build Optimizations

- **Turborepo caching**: Efficient monorepo builds
- **Angular optimizations**: Production builds with tree shaking
- **SSR performance**: Server-side rendering for faster initial loads
- **Asset optimization**: Optimized fonts, images, and static assets

## 🚀 Application Flow & User Experience

### Navigation Hierarchy

The application follows a clear hierarchical navigation pattern:

```text
Home (/) → Project Overview (/project/:id) → Dashboard Views
└── Project Cards         └── Project Details    └── Meetings
    └── Filter & Search       └── Metrics           └── Committees
                              └── Categories        └── Mailing Lists
```

### User Journey Design

1. **Landing Page**: Grid of project cards with filtering and search
2. **Project Overview**: Detailed project information with navigation tabs
3. **Dashboard Views**: Specialized views for different project aspects
4. **Consistent Layout**: Shared layout components ensure uniform experience

### Layout Component Strategy

#### ProjectLayoutComponent Pattern

```typescript
// Usage in dashboard components
@Component({
  selector: 'lfx-meeting-dashboard',
  template: `
    <lfx-project-layout
      [projectTitle]="'Kubernetes'"
      [projectDescription]="'Driving innovation with open-source projects'"
      [categoryLabel]="'CNCF'"
      [projectSlug]="'kubernetes'">
      <!-- Dashboard-specific content -->
      <div class="p-8">
        <h2>Meeting Dashboard Content</h2>
        <!-- Meeting dashboard implementation -->
      </div>
    </lfx-project-layout>
  `,
})
export class MeetingDashboardComponent {}
```

#### Benefits of Layout Components

- **Consistent UI**: Uniform breadcrumbs, navigation, and project headers
- **Reusability**: Single layout component for all project pages
- **Maintainability**: Changes to layout structure happen in one place
- **Navigation Management**: Automatic route generation based on project slug

## 🎯 PrimeNG Component Abstraction Strategy

### Wrapper Component Philosophy

All PrimeNG components are abstracted through LFX wrapper components:

```text
Application Code → LFX Wrapper → PrimeNG Component → DOM
    └── Clean API    └── Abstraction  └── UI Library    └── Rendered UI
```

### Current Wrapper Components

#### AvatarComponent (`lfx-avatar`)

**Features**: Intelligent priority system with automatic fallback logic

**Priority Chain**: image → icon → label (first character, uppercase)

```typescript
// Avatar with full fallback chain
<lfx-avatar
  [image]="user.picture"
  [icon]="'fa-light fa-user'"
  [label]="user.name"
  [shape]="'circle'"
  (onClick)="handleAvatarClick($event)">
</lfx-avatar>

// Component implementation with computed signals
@Component({
  selector: 'lfx-avatar',
  standalone: true,
  imports: [CommonModule, AvatarModule],
})
export class AvatarComponent {
  // Input signals
  public readonly image = input<string>('');
  public readonly icon = input<string>('');
  public readonly label = input<string>('');

  // Error handling
  private readonly imageErrorSignal = signal<boolean>(false);

  // Computed display logic
  public readonly displayImage = computed(() => {
    return this.image() && !this.imageErrorSignal() ? this.image() : '';
  });

  public readonly displayIcon = computed(() => {
    return !this.displayImage() && this.icon() ? this.icon() : '';
  });

  public readonly displayLabel = computed(() => {
    const image = this.displayImage();
    const icon = this.displayIcon();
    const label = this.label();

    if (!image && !icon && label) {
      return label.charAt(0).toUpperCase();
    }
    return '';
  });
}
```

#### MenuComponent (`lfx-menu`)

**Template Support**: `start`, `end`, `item`, `submenuheader`
**Enhanced Features**: Programmatic control with `toggle()`, `show()`, `hide()` methods

```html
<!-- Basic menu with templates -->
<lfx-menu [model]="menuItems()">
  <ng-template #start>
    <div class="menu-logo">
      <img src="logo.png" alt="Logo" />
    </div>
  </ng-template>

  <ng-template #item let-item>
    <a [routerLink]="item.routerLink" class="menu-item">
      <i [class]="item.icon"></i>
      <span>{{ item.label }}</span>
    </a>
  </ng-template>

  <ng-template #submenuheader let-item>
    <h3 class="submenu-header">{{ item.label }}</h3>
  </ng-template>

  <ng-template #end>
    <div class="menu-footer">
      <button>Settings</button>
    </div>
  </ng-template>
</lfx-menu>

<!-- Popup menu with programmatic control -->
<lfx-avatar (onClick)="userMenu.toggle($event)"></lfx-avatar>
<lfx-menu #userMenu [model]="userMenuItems" [popup]="true"></lfx-menu>
```

#### Benefits of Wrapper Strategy

1. **UI Library Independence**: Easy migration from PrimeNG to other libraries
2. **Consistent API**: All components follow Angular signals pattern
3. **Type Safety**: Proper TypeScript interfaces and validation
4. **Template Flexibility**: Full support for all PrimeNG template options
5. **Brand Consistency**: LFX-specific styling and behavior

### Wrapper Component Development Pattern

```typescript
// Template for creating new wrapper components
@Component({
  selector: 'lfx-[component-name]',
  standalone: true,
  imports: [CommonModule, [PrimeNGModule]],
  template: `
    <p-[component]
      [property]="property()"
      (event)="handleEvent($event)">

      <!-- Template projection patterns -->
      <ng-template #[templateName] let-context>
        <ng-container *ngTemplateOutlet="[templateName]Template || null; context: { $implicit: context }">
        </ng-container>
      </ng-template>
    </p-[component]>
  `
})
export class [ComponentName]Component {
  // Input signals for all PrimeNG properties
  public readonly property = input<Type>(defaultValue);

  // Output signals for all PrimeNG events
  public readonly event = output<EventType>();

  // Template references for content projection
  @ContentChild('[templateName]', { static: false }) [templateName]Template?: TemplateRef<any>;

  // Event handlers
  protected handleEvent(event: EventType): void {
    this.event.emit(event);
  }
}
```

## 🎨 Component Architecture Patterns

### Input Signals Pattern

Modern Angular component input handling:

```typescript
@Component({
  selector: 'lfx-project-card',
  template: `
    <div class="project-card">
      <h3>{{ displayTitle() }}</h3>
      <p>{{ description() }}</p>
      @if (hasMetrics()) {
        <div class="metrics">
          @for (metric of metrics(); track metric.label) {
            <span>{{ metric.value }}</span>
          }
        </div>
      }
    </div>
  `,
})
export class ProjectCardComponent {
  // Required inputs
  public readonly title = input.required<string>();
  public readonly description = input.required<string>();

  // Optional inputs with defaults
  public readonly metrics = input<ProjectMetric[]>([]);
  public readonly logoUrl = input<string>('');

  // Computed signals for derived state
  public readonly displayTitle = computed(() => this.title().toUpperCase());
  public readonly hasMetrics = computed(() => this.metrics().length > 0);
}
```

### Service Integration Pattern

Components integrate with services using signal-based state:

```typescript
@Component({
  selector: 'lfx-project-dashboard',
  template: `
    @if (loading()) {
      <div class="loading">Loading...</div>
    } @else if (error()) {
      <div class="error">{{ error() }}</div>
    } @else {
      <div class="content">
        @for (project of projects(); track project.uid) {
          <lfx-project-card [title]="project.name" [description]="project.description" [metrics]="project.metrics"> </lfx-project-card>
        }
      </div>
    }
  `,
})
export class ProjectDashboardComponent {
  private readonly projectService = inject(ProjectService);

  // Direct signal consumption from service
  protected readonly loading = this.projectService.loading;
  protected readonly error = this.projectService.error;
  protected readonly projects = this.projectService.projects;

  // Lifecycle hooks
  ngOnInit(): void {
    this.projectService.loadProjects();
  }
}
```

## 🔄 State Management Architecture

### Service-Based State Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly http = inject(HttpClient);

  // Private state signals
  private readonly projectsSignal = signal<Project[]>([]);
  private readonly loadingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<string | null>(null);

  // Public readonly signals
  public readonly projects = this.projectsSignal.asReadonly();
  public readonly loading = this.loadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();

  // Computed signals
  public readonly activeProjects = computed(() => this.projectsSignal().filter((p) => p.status === 'active'));

  public readonly projectCount = computed(() => this.projectsSignal().length);

  // Actions
  public async loadProjects(): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const projects = await this.http.get<Project[]>('/api/projects').toPromise();
      this.projectsSignal.set(projects || []);
    } catch (error) {
      this.errorSignal.set('Failed to load projects');
    } finally {
      this.loadingSignal.set(false);
    }
  }
}
```

## 🎯 Development Workflow

### Component Development Checklist

- [ ] **Component Selector**: Use `lfx-` prefix (enforced by ESLint)
- [ ] **Standalone Component**: Import dependencies explicitly
- [ ] **Input Signals**: Use `input()` and `input.required()` for properties
- [ ] **Output Signals**: Use `output()` for events
- [ ] **Template Logic**: Use `@if`, `@for`, `@switch` control flow
- [ ] **TrackBy Functions**: Required for all `@for` loops
- [ ] **Accessibility**: Include ARIA attributes and semantic HTML
- [ ] **Type Safety**: Define interfaces for all data structures

### Code Quality Standards

```typescript
// Good: Explicit imports, signals, proper typing
@Component({
  selector: 'lfx-example',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      @for (field of fields(); track field.id) {
        <input [type]="field.type" [formControlName]="field.name" [attr.aria-label]="field.label" />
      }
      <button type="submit" [disabled]="form.invalid">Submit</button>
    </form>
  `,
})
export class ExampleComponent {
  private readonly fb = inject(FormBuilder);

  public readonly fields = input.required<FormField[]>();
  public readonly submitted = output<FormValue>();

  public readonly form = this.fb.group({
    // Form configuration
  });

  protected onSubmit(): void {
    if (this.form.valid) {
      this.submitted.emit(this.form.value);
    }
  }
}
```

## 📦 Build & Deployment Strategy

### Development Commands

```bash
# Development
yarn start          # Angular dev server with HMR
yarn build          # Production build
yarn test           # Unit tests
yarn lint           # ESLint with auto-fix
yarn format         # Prettier formatting

# Production
yarn serve:ssr      # Serve SSR locally
yarn start:prod     # PM2 production start
yarn reload:prod    # Zero-downtime reload
```

### Production Optimizations

1. **Angular Optimizations**:
   - Tree shaking for unused code elimination
   - Lazy loading for code splitting
   - Angular Universal for SSR

2. **CSS Optimizations**:
   - PurgeCSS for unused style removal
   - CSS layer optimization
   - Font loading optimization

3. **Build Caching**:
   - Turborepo for monorepo build caching
   - Angular build cache
   - Asset fingerprinting

## 🔐 Authentication & Authorization

### Auth0 Integration

The application uses Auth0 for authentication via `express-openid-connect`:

```typescript
// server.ts
const authConfig: ConfigParams = {
  authRequired: true,
  auth0Logout: true,
  baseURL: process.env['PCC_BASE_URL'] || 'http://localhost:4000',
  clientID: process.env['PCC_AUTH0_CLIENT_ID'] || '1234',
  issuerBaseURL: process.env['PCC_AUTH0_ISSUER_BASE_URL'] || 'https://example.com',
  secret: process.env['PCC_AUTH0_SECRET'] || 'sufficiently-long-string',
  idTokenSigningAlg: 'HS256',
  authorizationParams: {
    response_type: 'code',
    audience: process.env['PCC_AUTH0_AUDIENCE'] || 'https://example.com',
    scope: 'openid email profile api offline_access',
  },
  clientSecret: process.env['PCC_AUTH0_CLIENT_SECRET'] || 'bar',
};

app.use(auth(authConfig));
```

### Authentication Flow

1. **Universal Protection**: All routes require authentication by default
2. **Auth0 Redirect**: Unauthenticated users are redirected to Auth0
3. **Session Management**: Successful authentication creates a session
4. **Token Access**: Sessions include user profile and API tokens
5. **Secure Logout**: Logout handled via Auth0's logout endpoint

### Accessing User Information in Components

```typescript
// Component or service
import { inject } from '@angular/core';
import { UserService } from '@services/user.service';

export class MyComponent {
  private readonly userService = inject(UserService);

  // Access reactive user state
  public readonly authenticated = this.userService.authenticated;
  public readonly user = this.userService.user;

  // Use in templates
  // @if (userService.authenticated()) { ... }
  // {{ userService.user()?.name }}
}
```

### User Menu Integration

The header component demonstrates full user authentication integration:

```typescript
// HeaderComponent implementation
@Component({
  selector: 'lfx-header',
  standalone: true,
  imports: [AvatarComponent, MenuComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA], // For LFX Tools
})
export class HeaderComponent {
  public readonly userService = inject(UserService);

  // User menu with environment-based URLs
  protected readonly userMenuItems: MenuItem[] = [
    {
      label: 'Profile',
      icon: 'fa-light fa-user',
      url: environment.urls.profile,
      target: '_blank',
    },
    {
      label: 'Developer Settings',
      icon: 'fa-light fa-cog',
      url: environment.urls.profile + '/developer-settings',
      target: '_blank',
    },
    {
      separator: true,
    },
    {
      label: 'Logout',
      icon: 'fa-light fa-sign-out',
      url: '/logout',
      target: '_self',
    },
  ];
}
```

**User Menu Features**:

- **Profile Picture Avatar**: Shows user image with fallback to icon and initials
- **Popup Menu**: Triggered by avatar click using Menu component's toggle functionality
- **External Navigation**: Profile links open in new tabs
- **Environment Configuration**: URLs configured via environment variables
- **Conditional Rendering**: Only appears when user is authenticated

## 📊 Logging & Monitoring

### Pino HTTP Logger Configuration

Structured JSON logging with security considerations:

```typescript
const logger = pinoHttp({
  autoLogging: {
    ignore: (req: Request) => {
      // Ignore health check endpoints to reduce noise
      return req.url === '/health' || req.url === '/api/health';
    },
  },
  redact: {
    // Remove sensitive data from logs
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    remove: true,
  },
  level: 'info',
});
```

### Logging Features

- **Structured JSON Format**: Machine-readable logs for analysis
- **Automatic Request Logging**: HTTP request/response tracking
- **Security-First**: Sensitive data automatically redacted
- **Health Check Filtering**: Reduced noise from monitoring probes
- **Error Context**: Full stack traces and error details

### Using the Logger

```typescript
// In request handlers
req.log.info({ userId: user.id }, 'User action performed');
req.log.error({ error }, 'Error rendering Angular application');

// Direct logger usage
logger.logger.info(`Server listening on port ${port}`);
```

## 🚀 Server-Side Rendering (SSR) Engine

### Angular 19 SSR Architecture

The application uses Angular's new `AngularNodeAppEngine` for improved SSR performance:

```typescript
const angularApp = new AngularNodeAppEngine();

app.use('/**', (req: Request, res: Response, next: NextFunction) => {
  angularApp
    .handle(req, {
      providers: [
        { provide: APP_BASE_HREF, useValue: process.env['PCC_BASE_URL'] },
        { provide: REQUEST, useValue: req },
        { provide: 'RESPONSE', useValue: res },
      ],
    })
    .then((response) => {
      if (response) {
        return writeResponseToNodeResponse(response, res);
      }
      return next();
    })
    .catch((error) => {
      req.log.error({ error }, 'Error rendering Angular application');
      // Proper error handling with status codes
    });
});
```

### SSR Benefits

- **Improved SEO**: Pre-rendered content for search engines
- **Faster Initial Load**: HTML delivered on first request
- **Better Performance**: Reduced client-side JavaScript execution
- **Progressive Enhancement**: Works without JavaScript enabled

## 🏥 Health Checks & Monitoring

### Health Endpoint

```typescript
// Health check endpoint (no auth, no logging)
app.get('/health', (_req: Request, res: Response) => {
  res.send('OK');
});
```

Features:

- Not protected by authentication
- Not logged to reduce noise
- Returns simple "OK" response
- Used by load balancers and monitoring tools

## 🎯 Future Architecture Considerations

### Planned Enhancements

1. **API Integration**:
   - PostgreSQL + PostgREST backend
   - HTTP interceptors for authentication
   - Error handling and retry logic

2. **Performance Optimizations**:
   - Virtual scrolling for large lists
   - Image optimization and lazy loading
   - Service worker for offline support

3. **Feature Additions**:
   - Real-time updates via WebSockets
   - Advanced filtering and search
   - Data visualization components

4. **Testing Improvements**:
   - E2E testing with Playwright
   - Visual regression testing
   - Performance testing

## 📦 Shared Package Architecture

### Design Philosophy

The `@lfx-pcc/shared` package follows a centralized approach to type safety and code reuse:

```text
Shared Package Strategy:
├── Interfaces-First Design    # TypeScript interfaces over union types
├── Centralized Constants      # Single source of truth for design tokens
├── Development Optimization   # Direct source imports via path mapping
└── Production Efficiency      # Tree-shaking for minimal bundles
```

### Package Structure

```typescript
// packages/shared/src/interfaces/
export interface ProjectCardMetric {
  icon: string;
  label: string;
  value: string;
  badge?: {
    label: string;
    severity: 'success' | 'info' | 'warning' | 'danger';
  };
}

export interface BadgeProps {
  value: string | number;
  severity: 'info' | 'success' | 'warn' | 'danger' | 'secondary' | 'contrast';
  size: 'small' | 'large' | 'xlarge';
  styleClass: string;
  badgeDisabled: boolean;
}

export interface AuthContext {
  authenticated: boolean;
  user: User | null;
  permissions: any[];
  userDetails: LFXUser | null;
}
```

### Import Patterns

```typescript
// Component implementation
import { Component, input } from '@angular/core';
import { BadgeProps } from '@lfx-pcc/shared/interfaces';
import { lfxColors } from '@lfx-pcc/shared/constants';

@Component({
  selector: 'lfx-badge',
  template: `<p-badge [value]="value()" [severity]="severity()"></p-badge>`,
})
export class BadgeComponent {
  public readonly value = input<BadgeProps['value']>('');
  public readonly severity = input<BadgeProps['severity']>('info');
}
```

### Development Workflow

1. **Type Definition**: Add interfaces to appropriate files in `packages/shared/src/interfaces/`
2. **Export Management**: Update module index files to expose new types
3. **Component Usage**: Import and use interfaces in component implementations
4. **Hot Reloading**: Changes automatically trigger rebuilds across the monorepo

### Build Configuration

```json
// packages/shared/package.json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./interfaces": {
      "import": "./dist/interfaces/index.js",
      "types": "./dist/interfaces/index.d.ts"
    },
    "./constants": {
      "import": "./dist/constants/index.js",
      "types": "./dist/constants/index.d.ts"
    }
  }
}
```

### Performance Benefits

- **Development**: Direct source imports via TypeScript path mapping (no build step required)
- **Production**: Tree-shaking eliminates unused exports from final bundles
- **Type Safety**: Full IntelliSense and compile-time checking across packages
- **Cache Efficiency**: Turbo caches shared package builds for faster CI/CD

This architecture provides a modern, performant, and maintainable foundation for the LFX PCC application with clear patterns for scaling and future enhancements.

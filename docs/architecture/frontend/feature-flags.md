<!-- cspell:ignore rollouts -->

# Feature Flags

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Implementation Details](#-implementation-details)
- [Usage Patterns](#-usage-patterns)
- [Reactivity & Change Detection](#-reactivity--change-detection)
- [Configuration](#-configuration)
- [Best Practices](#-best-practices)
- [Error Handling & Fallbacks](#-error-handling--fallbacks)
- [Real-World Examples](#-real-world-examples)
- [Troubleshooting](#-troubleshooting)
- [Related Documentation](#-related-documentation)

## 🎯 Overview

Feature flags (also known as feature toggles) are a software development technique that allows you to enable or disable features at runtime without deploying new code. This provides powerful capabilities for:

- **Progressive rollouts**: Release features to specific users or groups
- **A/B testing**: Compare different implementations with real users
- **Quick rollbacks**: Disable problematic features instantly without redeployment
- **Environment-specific features**: Enable features in dev/staging but not production
- **Dark launches**: Deploy code to production but keep features hidden until ready

### Why OpenFeature + LaunchDarkly?

LFX One uses **OpenFeature** as a vendor-agnostic abstraction layer with **LaunchDarkly** as the feature flag provider:

- **OpenFeature**: Provides a standardized API for feature flags, preventing vendor lock-in
- **LaunchDarkly**: Enterprise-grade feature flag platform with real-time updates, targeting rules, and analytics
- **Signal-based integration**: Native Angular 19 signals provide automatic reactivity without manual change detection

### Benefits for LFX One

1. **Zoneless Compatibility**: Fully compatible with Angular 19's experimental zoneless change detection
2. **Real-time Updates**: Flag changes in LaunchDarkly propagate instantly to the UI without refresh
3. **Type Safety**: TypeScript interfaces ensure compile-time safety for flag values
4. **SSR Support**: Graceful handling of server-side rendering with browser-only initialization
5. **Developer Experience**: Simple signal-based API requires no manual subscriptions or change detection

## 🏗 Architecture

### System Overview

The feature flag system consists of three main components:

```text
┌─────────────────────────────────────────────────────────────┐
│                     Application Startup                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. provideAppInitializer (provideFeatureFlags)             │
│     └─> Initialize LaunchDarkly Provider                     │
│         └─> OpenFeature.setProviderAndWait()                │
│                                                               │
│  2. app.component.ts Constructor                             │
│     └─> Get authenticated user from Auth0                    │
│         └─> featureFlagService.initialize(user)             │
│             └─> Set user context in OpenFeature             │
│             └─> Get OpenFeature client                       │
│             └─> Set isInitialized = true                     │
│             └─> Setup event handlers                         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    FeatureFlagService                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Private State:                                              │
│    • client: OpenFeature Client                             │
│    • isInitialized: WritableSignal<boolean>                 │
│    • context: WritableSignal<EvaluationContext>             │
│                                                               │
│  Public API (all return Signal<T>):                         │
│    • initialized: Signal<boolean>                            │
│    • getBooleanFlag(key, default): Signal<boolean>          │
│    • getStringFlag(key, default): Signal<string>            │
│    • getNumberFlag(key, default): Signal<number>            │
│    • getObjectFlag(key, default): Signal<T>                 │
│                                                               │
│  Event Handlers:                                             │
│    • Ready, ConfigurationChanged, ContextChanged            │
│    • All trigger refreshFlags() → context signal update     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Components                              │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Inject FeatureFlagService                                │
│  2. Call getBooleanFlag('flag-key', defaultValue)           │
│  3. Receive Signal<boolean>                                  │
│  4. Use in computed() or directly in template               │
│  5. Automatic re-render on flag changes                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Signal-Based Reactivity

The service uses Angular signals for automatic reactivity:

1. **Context Signal**: Private `context` signal triggers re-evaluation when updated
2. **Computed Flag Signals**: Each `getXxxFlag()` method returns a computed signal that:
   - Depends on the `context` signal
   - Re-evaluates when context changes
   - Automatically updates the UI without manual change detection
3. **Event-Driven Updates**: LaunchDarkly provider events trigger context refresh, causing all flag signals to re-evaluate

This design provides:

- **Zero Subscriptions**: No manual subscribe/unsubscribe management
- **Automatic Cleanup**: Signals are garbage collected with components
- **Zoneless Compatible**: Works perfectly with Angular 19's zoneless change detection
- **Referential Stability**: Same signal instance is returned across calls (use computed() for derived logic)

## 🔧 Implementation Details

### Service Configuration

The `FeatureFlagService` is located at `src/app/shared/services/feature-flag.service.ts`:

```typescript
@Injectable({
  providedIn: 'root',
})
export class FeatureFlagService {
  private client: Client | null = null;
  private readonly isInitialized = signal<boolean>(false);
  private readonly context = signal<EvaluationContext | null>(null);

  // Public readonly signals
  public readonly initialized = this.isInitialized.asReadonly();

  /**
   * Initialize OpenFeature client with user context
   * Call this method from app.component when user is authenticated
   */
  public async initialize(user: any): Promise<void> {
    if (this.isInitialized()) {
      return;
    }

    try {
      const userContext: EvaluationContext = {
        kind: 'user',
        name: user.name || '',
        email: user.email || '',
        targetingKey: user.preferred_username || user.username || user.sub || '',
      };

      await OpenFeature.setContext(userContext);
      this.client = OpenFeature.getClient();
      this.context.set(userContext);
      this.isInitialized.set(true);

      this.setupEventHandlers();
    } catch (error) {
      console.error('Failed to initialize feature flag service:', error);
      this.isInitialized.set(false);
    }
  }
}
```

**Key Design Decisions:**

- **Singleton Service**: `providedIn: 'root'` ensures single instance across application
- **Private State**: `client`, `isInitialized`, and `context` are private for encapsulation
- **Public Readonly Signals**: Exposed signals use `asReadonly()` to prevent external mutation
- **Lazy Initialization**: Service doesn't initialize in constructor; waits for explicit `initialize()` call
- **Idempotent**: Multiple `initialize()` calls are safe (checks `isInitialized()` first)

### Provider Setup

The OpenFeature provider is configured in `src/app/shared/providers/feature-flag.provider.ts`:

```typescript
function initializeOpenFeature(): () => Promise<void> {
  return async () => {
    // Skip initialization on server
    if (typeof window === 'undefined') {
      return;
    }

    // Skip if no client ID is configured
    if (!environment.launchDarklyClientId) {
      console.warn('LaunchDarkly client ID not configured - feature flags disabled');
      return;
    }

    try {
      const provider = new LaunchDarklyClientProvider(environment.launchDarklyClientId, {
        initializationTimeout: 5,
        streaming: true,
        logger: basicLogger({ level: environment.production ? 'none' : 'info' }),
      });

      await OpenFeature.setProviderAndWait(provider);
    } catch (error) {
      console.error('Failed to initialize OpenFeature with LaunchDarkly:', error);
      // App continues without feature flags
    }
  };
}

/**
 * Provider for OpenFeature initialization using Angular 19's provideAppInitializer
 */
export const provideFeatureFlags = (): EnvironmentProviders => provideAppInitializer(initializeOpenFeature());
```

**Provider Configuration:**

- **provideAppInitializer**: Angular 19's modern API for app initialization, runs during application bootstrap before components render
- **SSR Guard**: `typeof window === 'undefined'` check prevents server-side execution
- **Graceful Degradation**: Missing configuration or errors allow app to continue with default flag values
- **Streaming Mode**: Real-time flag updates from LaunchDarkly
- **Environment-Aware Logging**: Info level in development, none in production

### Event Handling

The service sets up event handlers for real-time flag updates:

```typescript
private setupEventHandlers(): void {
  if (!this.client) {
    return;
  }

  const forceSignalUpdate = () => {
    // Force re-evaluation by updating context reference
    this.refreshFlags();
  };

  // Set up event handlers for flag changes
  this.client.addHandler(ProviderEvents.Ready, forceSignalUpdate);
  this.client.addHandler(ProviderEvents.ConfigurationChanged, forceSignalUpdate);
  this.client.addHandler(ProviderEvents.ContextChanged, forceSignalUpdate);
  this.client.addHandler(ProviderEvents.Reconciling, forceSignalUpdate);
  this.client.addHandler(ProviderEvents.Stale, forceSignalUpdate);
  this.client.addHandler(ProviderEvents.Error, () => {
    console.error('Feature flag provider error');
  });
}

private refreshFlags(): void {
  const current = this.context();
  if (current) {
    this.context.set({ ...current });
  }
}
```

**Event Types:**

- **Ready**: Provider is ready to evaluate flags
- **ConfigurationChanged**: Flag configuration updated in LaunchDarkly
- **ContextChanged**: User context changed (different user, attributes updated)
- **Reconciling**: Provider is syncing with LaunchDarkly
- **Stale**: Cached data is stale, reconciliation needed
- **Error**: Provider encountered an error

**Update Mechanism:**

The `refreshFlags()` method creates a new context reference (`{ ...current }`), which:

1. Triggers Angular's signal change detection
2. Causes all computed flag signals to re-evaluate
3. Updates the UI automatically
4. Maintains referential integrity for computed signals

## 🚀 Usage Patterns

### Basic Boolean Flags

The most common pattern is boolean flags for feature toggles:

```typescript
export class MyComponent {
  private readonly featureFlagService = inject(FeatureFlagService);

  // Create a signal that tracks the flag value
  protected readonly showNewFeature = this.featureFlagService.getBooleanFlag('new-feature', false);
}
```

```html
<!-- Use directly in template -->
@if (showNewFeature()) {
<div>New Feature Content</div>
}
```

**API:**

```typescript
getBooleanFlag(key: string, defaultValue: boolean = false): Signal<boolean>
```

**Parameters:**

- `key`: String identifier for the flag (matches LaunchDarkly flag key)
- `defaultValue`: Value returned when flag doesn't exist or service isn't initialized

**Returns:** A reactive `Signal<boolean>` that updates automatically

### Conditional Rendering

Use feature flags to show/hide UI elements with Angular's `@if` syntax:

**Example from `board-member-dashboard.component.ts`:**

```typescript
export class BoardMemberDashboardComponent {
  private readonly featureFlagService = inject(FeatureFlagService);

  // Feature flag to control organization selector visibility
  protected readonly showOrganizationSelector = this.featureFlagService.getBooleanFlag('organization-selector', true);
}
```

**Template (`board-member-dashboard.component.html`):**

```html
<!-- Organization Selector -->
@if (showOrganizationSelector()) {
<div class="mb-6 flex items-center gap-4" data-testid="organization-selector">
  <label for="organization-select" class="text-sm font-semibold text-gray-700">Organization:</label>
  <lfx-select
    [form]="form"
    control="selectedAccountId"
    [options]="availableAccounts()"
    optionLabel="accountName"
    optionValue="accountId"
    [filter]="true"
    filterPlaceholder="Search organizations..."
    placeholder="Select an organization"
    [showClear]="false"
    styleClass="min-w-[300px]"
    inputId="organization-select"
    data-testid="organization-select" />
</div>
}
```

**Pattern Benefits:**

- **Declarative**: Template clearly shows conditional logic
- **Performance**: Angular only renders content when flag is true
- **Type-Safe**: TypeScript ensures signal invocation with `()`
- **Reactive**: Changes in LaunchDarkly instantly show/hide element

### Array Filtering

Use feature flags with `computed()` signals to dynamically filter arrays:

**Example from `main-layout.component.ts`:**

```typescript
export class MainLayoutComponent {
  private readonly featureFlagService = inject(FeatureFlagService);

  // Feature flag for sidebar projects visibility
  private readonly showProjectsInSidebar = this.featureFlagService.getBooleanFlag('sidebar-projects', true);

  // Base sidebar navigation items
  private readonly baseSidebarItems: SidebarMenuItem[] = [
    {
      label: 'Overview',
      icon: 'fa-light fa-grid-2',
      routerLink: '/',
    },
    {
      label: 'Meetings',
      icon: 'fa-light fa-calendar',
      routerLink: '/meetings',
    },
    {
      label: 'Projects',
      icon: 'fa-light fa-folder-open',
      routerLink: '/projects',
    },
  ];

  // Computed sidebar items based on feature flags
  protected readonly sidebarItems = computed(() => {
    const items = [...this.baseSidebarItems];

    // Filter out Projects if feature flag is disabled
    if (!this.showProjectsInSidebar()) {
      return items.filter((item) => item.label !== 'Projects');
    }

    return items;
  });
}
```

**Template (`main-layout.component.html`):**

```html
<!-- Sidebar with filtered items -->
<lfx-sidebar [items]="sidebarItems()" [footerItems]="sidebarFooterItems" [showProjectSelector]="true"></lfx-sidebar>
```

**Pattern Benefits:**

- **Separation of Concerns**: Base data separate from filtering logic
- **Composable**: Multiple flags can filter different items independently
- **Reactive**: Computed signal automatically updates when any dependency changes
- **Performance**: Only recomputes when flag values change

### Additional Flag Types

Beyond booleans, the service supports string, number, and object flags:

#### String Flags

```typescript
// Get a string configuration value
protected readonly apiEndpoint = this.featureFlagService.getStringFlag('api-endpoint', 'https://api.example.com');
```

**API:**

```typescript
getStringFlag(key: string, defaultValue: string = ''): Signal<string>
```

**Use Cases:** API endpoints, theme names, configuration strings

#### Number Flags

```typescript
// Get a numeric configuration value
protected readonly maxResults = this.featureFlagService.getNumberFlag('max-results', 50);
```

**API:**

```typescript
getNumberFlag(key: string, defaultValue: number = 0): Signal<number>
```

**Use Cases:** Pagination limits, timeout values, thresholds

#### Object Flags

```typescript
// Get a complex configuration object
interface FeatureConfig {
  enabled: boolean;
  options: string[];
  threshold: number;
}

protected readonly featureConfig = this.featureFlagService.getObjectFlag<FeatureConfig>('feature-config', {
  enabled: false,
  options: [],
  threshold: 0,
});
```

**API:**

```typescript
getObjectFlag<T extends JsonValue = JsonValue>(key: string, defaultValue: T): Signal<T>
```

**Use Cases:** Complex configurations, multi-option settings, nested configuration objects

**Important:** Object flags must be JSON-serializable (primitives, arrays, objects only - no functions or class instances)

## 🔄 Reactivity & Change Detection

### Signal-Based Updates

The feature flag system uses Angular signals for automatic reactivity:

```typescript
public getBooleanFlag(key: string, defaultValue: boolean = false): Signal<boolean> {
  return computed(() => {
    // Reactive dependency on context signal
    this.context();

    if (!this.isInitialized() || !this.client) {
      return defaultValue;
    }

    try {
      return this.client.getBooleanValue(key, defaultValue);
    } catch (error) {
      console.error(`Error evaluating boolean flag '${key}':`, error);
      return defaultValue;
    }
  });
}
```

**How It Works:**

1. **Computed Signal**: Each flag method returns a `computed()` signal
2. **Context Dependency**: The computed signal reads `this.context()`, creating a reactive dependency
3. **Automatic Tracking**: Angular tracks this dependency and re-runs the computation when context changes
4. **UI Updates**: Components using the flag signal automatically re-render when the flag value changes

**No Manual Change Detection:**

- No need to call `ChangeDetectorRef.markForCheck()`
- No need to run code in `NgZone`
- No need to use `async` pipe
- Works seamlessly with zoneless change detection

### Real-Time Flag Updates

When flags change in LaunchDarkly:

```text
1. LaunchDarkly emits ConfigurationChanged event
   ↓
2. Event handler calls refreshFlags()
   ↓
3. refreshFlags() updates context signal with new reference
   ↓
4. All computed flag signals detect context change
   ↓
5. Computed signals re-evaluate and get new flag values
   ↓
6. Components using these signals automatically re-render
   ↓
7. User sees updated UI instantly (no page refresh)
```

**Example Timeline:**

```text
Time  | Action                                    | Result
------|-------------------------------------------|---------------------------
T+0   | Developer toggles 'new-feature' in LD    | Event queued
T+50ms| ConfigurationChanged event received      | refreshFlags() called
T+51ms| context signal updated                   | Flag signals re-evaluate
T+52ms| showNewFeature() returns new value       | Component re-renders
T+53ms| Template @if condition evaluated         | UI updated
```

**Streaming Connection:**

The LaunchDarkly provider uses Server-Sent Events (SSE) for real-time updates:

- **Persistent Connection**: Maintained in the background
- **Low Latency**: Updates typically arrive within 50-200ms
- **Automatic Reconnection**: Provider handles connection failures
- **Graceful Degradation**: Falls back to polling if SSE unavailable

## ⚙️ Configuration

### Environment Setup

Feature flags require configuration in environment files:

**`src/environments/environment.ts` (development):**

```typescript
export const environment = {
  production: false,
  launchDarklyClientId: 'your-dev-client-id-here',
  // ... other environment variables
};
```

**`src/environments/environment.prod.ts` (production):**

```typescript
export const environment = {
  production: true,
  launchDarklyClientId: 'your-prod-client-id-here',
  // ... other environment variables
};
```

**Getting Your Client ID:**

1. Log in to LaunchDarkly dashboard
2. Navigate to Account Settings → Projects
3. Select your project and environment (Development, Staging, Production)
4. Copy the "Client-side ID" (not the SDK key)
5. Add to appropriate environment file

**Important:**

- Use **different client IDs** for each environment
- Client-side IDs are safe to commit to version control (they're public)
- Server-side SDK keys should **never** be in client code

### LaunchDarkly Provider Options

The provider is configured in `feature-flag.provider.ts`:

```typescript
const provider = new LaunchDarklyClientProvider(environment.launchDarklyClientId, {
  initializationTimeout: 5, // seconds
  streaming: true,
  logger: basicLogger({ level: environment.production ? 'none' : 'info' }),
});
```

**Configuration Options:**

| Option                       | Type    | Default | Description                                     |
| ---------------------------- | ------- | ------- | ----------------------------------------------- |
| `initializationTimeout`      | number  | 5       | Max seconds to wait for initial flag fetch      |
| `streaming`                  | boolean | true    | Enable real-time updates via Server-Sent Events |
| `logger`                     | object  | none    | LaunchDarkly logger for debugging               |
| `bootstrap`                  | object  | -       | Pre-populate flags (useful for SSR)             |
| `sendEventsOnlyForVariation` | boolean | false   | Reduce analytics events sent to LaunchDarkly    |

**Logger Levels:**

- `'none'`: No logging (production)
- `'error'`: Errors only
- `'warn'`: Errors and warnings
- `'info'`: Errors, warnings, and info (development)
- `'debug'`: All messages including debug info

**Production Recommendations:**

```typescript
// Production: Minimal logging, conservative timeout
{
  initializationTimeout: 3,
  streaming: true,
  logger: basicLogger({ level: 'none' }),
  sendEventsOnlyForVariation: true,
}

// Development: Verbose logging, longer timeout for debugging
{
  initializationTimeout: 10,
  streaming: true,
  logger: basicLogger({ level: 'info' }),
}
```

### User Context

User context enables targeted flag delivery based on user attributes:

```typescript
const userContext: EvaluationContext = {
  kind: 'user',
  name: user.name || '',
  email: user.email || '',
  targetingKey: user.preferred_username || user.username || user.sub || '',
};
```

**Context Structure:**

| Field             | Type   | Required | Description                         |
| ----------------- | ------ | -------- | ----------------------------------- |
| `kind`            | string | Yes      | Always 'user' for user contexts     |
| `targetingKey`    | string | Yes      | Unique identifier for the user      |
| `name`            | string | No       | Display name for LaunchDarkly UI    |
| `email`           | string | No       | Email for targeting rules           |
| Custom attributes | any    | No       | Additional attributes for targeting |

**Targeting Use Cases:**

1. **User-Specific Rollouts**: Enable feature for specific users by email or ID
2. **Percentage Rollouts**: Show feature to 10% of users randomly
3. **Segment Targeting**: Enable for specific user groups (e.g., beta testers)
4. **A/B Testing**: Show variant A to 50% of users, variant B to 50%

**Adding Custom Attributes:**

```typescript
const userContext: EvaluationContext = {
  kind: 'user',
  targetingKey: user.sub,
  name: user.name,
  email: user.email,
  // Custom attributes for targeting
  organization: user.organization,
  role: user.role,
  plan: user.subscriptionPlan,
  betaTester: user.isBetaTester,
};
```

Custom attributes can then be used in LaunchDarkly targeting rules.

## 📝 Best Practices

### Service Initialization

✅ **DO: Initialize in app.component after authentication**

```typescript
export class AppComponent implements OnInit {
  private readonly featureFlagService = inject(FeatureFlagService);

  constructor() {
    const user = /* get authenticated user */;
    if (user) {
      this.featureFlagService.initialize(user);
    }
  }
}
```

❌ **DON'T: Initialize in service constructor**

```typescript
// BAD: Service doesn't have access to user during construction
constructor() {
  this.initialize(); // No user context available!
}
```

**Why:** The service needs user context for targeting rules. User information is only available after authentication completes.

### Component Patterns

✅ **DO: Inject service at component level**

```typescript
export class MyComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  protected readonly showFeature = this.featureFlagService.getBooleanFlag('my-feature', false);
}
```

❌ **DON'T: Create service instances manually**

```typescript
// BAD: Bypasses dependency injection
const service = new FeatureFlagService();
```

**Why:** Angular's dependency injection ensures proper singleton behavior and lifecycle management.

### Default Values

✅ **DO: Provide sensible defaults matching current behavior**

```typescript
// Default true maintains current behavior if flag doesn't exist
protected readonly showOrganizationSelector = this.featureFlagService.getBooleanFlag('organization-selector', true);
```

❌ **DON'T: Use false as default for existing features**

```typescript
// BAD: Existing feature will disappear if flag not found
protected readonly showExistingFeature = this.featureFlagService.getBooleanFlag('existing-feature', false);
```

**Why:** Default values are used when:

- Flag doesn't exist in LaunchDarkly
- Service initialization fails
- Network is offline
- LaunchDarkly is unreachable

Choose defaults that maintain current application behavior to avoid breaking changes during outages.

### Signal Usage

✅ **DO: Use computed() for derived flag logic**

```typescript
protected readonly sidebarItems = computed(() => {
  const items = [...this.baseSidebarItems];

  if (!this.showProjectsInSidebar()) {
    return items.filter((item) => item.label !== 'Projects');
  }

  return items;
});
```

❌ **DON'T: Use effect() to update other signals**

```typescript
// BAD: Creates unnecessary complexity and potential infinite loops
effect(() => {
  if (this.showProjectsInSidebar()) {
    this.sidebarItems.set([...]); // Avoid!
  }
});
```

**Why:** `computed()` signals:

- Automatically track dependencies
- Only recompute when dependencies change
- Are easier to test and reason about
- Avoid potential infinite loops

### Template Patterns

✅ **DO: Invoke signals in templates with ()**

```html
@if (showFeature()) {
<div>Content</div>
}
```

❌ **DON'T: Pass signals without invoking**

```html
<!-- BAD: Type error - Signal<boolean> is not assignable to boolean -->
@if (showFeature) {
<div>Content</div>
}
```

**Why:** Signals are functions that return values. You must invoke them to get the current value.

### Flag Key Management

✅ **DO: Use inline string literals for flag keys**

```typescript
protected readonly showFeature = this.featureFlagService.getBooleanFlag('new-feature', false);
```

✅ **ALSO ACCEPTABLE: Centralize in constants for reuse**

```typescript
// shared/constants/feature-flags.ts
export const FEATURE_FLAGS = {
  NEW_FEATURE: 'new-feature',
  SIDEBAR_PROJECTS: 'sidebar-projects',
} as const;

// component
protected readonly showFeature = this.featureFlagService.getBooleanFlag(FEATURE_FLAGS.NEW_FEATURE, false);
```

**Benefits of constants:**

- Autocomplete in IDE
- Refactoring support
- Single source of truth
- Type safety for flag keys

### Performance Considerations

✅ **DO: Create flag signals at component initialization**

```typescript
export class MyComponent {
  // Created once during component construction
  protected readonly showFeature = this.featureFlagService.getBooleanFlag('my-feature', false);
}
```

❌ **DON'T: Create flag signals in methods or templates**

```typescript
// BAD: Creates new signal on every method call
public get showFeature() {
  return this.featureFlagService.getBooleanFlag('my-feature', false);
}
```

**Why:** Creating signals repeatedly causes:

- Unnecessary memory allocation
- Loss of referential stability for computed signals
- Potential performance issues in templates

### Error Handling

✅ **DO: Handle initialization failures gracefully**

```typescript
async ngOnInit() {
  try {
    await this.featureFlagService.initialize(this.user);
  } catch (error) {
    // Log error but continue - default values will be used
    console.error('Feature flag initialization failed:', error);
  }
}
```

✅ **DO: Provide fallback UI for critical features**

```typescript
@if (isLoading()) {
  <lfx-skeleton></lfx-skeleton>
} @else if (showNewDashboard()) {
  <app-new-dashboard></app-new-dashboard>
} @else {
  <app-legacy-dashboard></app-legacy-dashboard>
}
```

**Why:** Graceful degradation ensures users can still use the application even when feature flags are unavailable.

## 🚨 Error Handling & Fallbacks

### Initialization Failures

The service handles initialization failures gracefully:

```typescript
try {
  const provider = new LaunchDarklyClientProvider(environment.launchDarklyClientId, {
    initializationTimeout: 5,
    streaming: true,
  });

  await OpenFeature.setProviderAndWait(provider);
} catch (error) {
  console.error('Failed to initialize OpenFeature with LaunchDarkly:', error);
  // App continues without feature flags
}
```

**Failure Scenarios:**

1. **Missing Client ID**: Console warning, flags disabled, defaults used
2. **Network Timeout**: Provider initialization fails, defaults used
3. **Invalid Client ID**: LaunchDarkly rejects connection, defaults used
4. **Server-Side Rendering**: Initialization skipped (browser-only check)

**Application Behavior:**

- Application continues to function normally
- All feature flags return their default values
- No user-facing errors or broken UI
- Console logs provide debugging information

### Runtime Errors

Individual flag evaluations are wrapped in try-catch:

```typescript
try {
  return this.client.getBooleanValue(key, defaultValue);
} catch (error) {
  console.error(`Error evaluating boolean flag '${key}':`, error);
  return defaultValue;
}
```

**Error Scenarios:**

- Flag key doesn't exist in LaunchDarkly
- Type mismatch (requesting boolean for string flag)
- Evaluation context invalid
- Client disconnected

**Fallback Strategy:**

1. Log error to console for debugging
2. Return the provided default value
3. Continue application execution
4. No user-facing error messages

### Network Resilience

The LaunchDarkly provider handles network issues:

**Offline Behavior:**

- Uses cached flag values from previous session
- Falls back to defaults for new flags
- Automatically reconnects when network available
- Queues analytics events for later delivery

**Reconnection Strategy:**

```text
1. Connection lost
   ↓
2. Provider emits Stale event
   ↓
3. Provider attempts reconnection with exponential backoff
   ↓
4. On reconnection: Fetches latest flag values
   ↓
5. Emits ConfigurationChanged event
   ↓
6. UI updates with latest values
```

### Console Logging

The system logs errors at appropriate levels:

**Development:**

```typescript
// Info level logging for debugging
logger: basicLogger({ level: 'info' });
```

**Production:**

```typescript
// No logging to reduce noise
logger: basicLogger({ level: 'none' });
```

**Error Types:**

| Severity | Message                                     | When                          |
| -------- | ------------------------------------------- | ----------------------------- |
| WARN     | "LaunchDarkly client ID not configured"     | Missing environment variable  |
| ERROR    | "Failed to initialize OpenFeature"          | Provider initialization fails |
| ERROR    | "Failed to initialize feature flag service" | User context setup fails      |
| ERROR    | "Error evaluating [type] flag '[key]'"      | Individual flag error         |
| ERROR    | "Feature flag provider error"               | Provider runtime error        |

## 🎨 Real-World Examples

### Example 1: Conditional Feature Access

Show or hide the organization selector in the board member dashboard:

**Component (`board-member-dashboard.component.ts`):**

```typescript
import { Component, inject, Signal, computed } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { FeatureFlagService } from '../../../shared/services/feature-flag.service';
import { Account } from '@lfx-one/shared/interfaces';

export class BoardMemberDashboardComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly featureFlagService = inject(FeatureFlagService);

  public readonly form = new FormGroup({
    selectedAccountId: new FormControl<string>(this.accountContextService.selectedAccount().accountId),
  });

  public readonly availableAccounts: Signal<Account[]> = computed(() => this.accountContextService.availableAccounts);

  // Feature flag: show/hide organization selector
  // Default true maintains current behavior
  protected readonly showOrganizationSelector = this.featureFlagService.getBooleanFlag('organization-selector', true);
}
```

**Template (`board-member-dashboard.component.html`):**

```html
<!-- Organization Selector - conditionally rendered -->
@if (showOrganizationSelector()) {
<div class="mb-6 flex items-center gap-4" data-testid="organization-selector">
  <label for="organization-select" class="text-sm font-semibold text-gray-700">Organization:</label>
  <lfx-select
    [form]="form"
    control="selectedAccountId"
    [options]="availableAccounts()"
    optionLabel="accountName"
    optionValue="accountId"
    [filter]="true"
    filterPlaceholder="Search organizations..."
    placeholder="Select an organization"
    [showClear]="false"
    styleClass="min-w-[300px]"
    inputId="organization-select"
    data-testid="organization-select" />
</div>
}

<!-- Rest of dashboard content always visible -->
<div class="dashboard-content">
  <!-- ... -->
</div>
```

**Use Cases:**

- **Progressive Rollout**: Test organization selector with specific users first
- **A/B Testing**: Compare dashboard usage with/without selector
- **Quick Rollback**: Disable immediately if performance issues occur
- **Environment Control**: Hide in production but show in staging

### Example 2: Navigation Filtering

Dynamically filter sidebar navigation items based on feature flags:

**Component (`main-layout.component.ts`):**

```typescript
import { Component, inject, computed } from '@angular/core';
import { Router } from '@angular/router';

import { FeatureFlagService } from '../../shared/services/feature-flag.service';
import { AppService } from '../../shared/services/app.service';
import { SidebarMenuItem } from '@lfx-one/shared/interfaces';

export class MainLayoutComponent {
  private readonly router = inject(Router);
  private readonly appService = inject(AppService);
  private readonly featureFlagService = inject(FeatureFlagService);

  // Feature flag: show/hide Projects in sidebar
  private readonly showProjectsInSidebar = this.featureFlagService.getBooleanFlag('sidebar-projects', true);

  // Base sidebar navigation items - complete set
  private readonly baseSidebarItems: SidebarMenuItem[] = [
    {
      label: 'Overview',
      icon: 'fa-light fa-grid-2',
      routerLink: '/',
    },
    {
      label: 'Meetings',
      icon: 'fa-light fa-calendar',
      routerLink: '/meetings',
    },
    {
      label: 'Projects',
      icon: 'fa-light fa-folder-open',
      routerLink: '/projects',
    },
  ];

  // Computed sidebar items based on feature flags
  // Re-evaluates automatically when showProjectsInSidebar changes
  protected readonly sidebarItems = computed(() => {
    const items = [...this.baseSidebarItems];

    // Filter out Projects if feature flag is disabled
    if (!this.showProjectsInSidebar()) {
      return items.filter((item) => item.label !== 'Projects');
    }

    return items;
  });
}
```

**Template (`main-layout.component.html`):**

```html
<!-- Desktop Sidebar -->
<div class="hidden lg:block w-64 flex-shrink-0 fixed top-0 left-0">
  <lfx-sidebar [items]="sidebarItems()" [footerItems]="sidebarFooterItems" [showProjectSelector]="true"></lfx-sidebar>
</div>

<!-- Mobile Sidebar -->
<div class="overflow-y-auto h-[calc(100vh-4rem)]">
  <lfx-sidebar [items]="sidebarItems()" [footerItems]="sidebarFooterItems" [showProjectSelector]="true"></lfx-sidebar>
</div>
```

**Use Cases:**

- **Phased Rollout**: Hide unfinished Projects section until ready
- **Access Control**: Show/hide features based on user permissions (via targeting)
- **Feature Gating**: Enable premium features only for paid users
- **Maintenance Mode**: Temporarily hide sections during maintenance

**Benefits:**

- Single computed signal handles filtering logic
- Multiple flags can filter different items independently
- Sidebar component receives clean, filtered array
- No awareness of feature flags in child components

### Example 3: Multi-Flag Composition

Combine multiple feature flags with complex logic:

```typescript
export class DashboardComponent {
  private readonly featureFlagService = inject(FeatureFlagService);

  // Multiple feature flags
  private readonly showAnalytics = this.featureFlagService.getBooleanFlag('analytics-dashboard', false);
  private readonly showReports = this.featureFlagService.getBooleanFlag('reports-section', true);
  private readonly showCharts = this.featureFlagService.getBooleanFlag('interactive-charts', false);

  // Derived flag: analytics requires charts
  protected readonly showFullAnalytics = computed(() => {
    return this.showAnalytics() && this.showCharts();
  });

  // Composite dashboard sections
  protected readonly dashboardSections = computed(() => {
    const sections = [];

    // Always show overview
    sections.push({ id: 'overview', title: 'Overview', component: 'OverviewComponent' });

    // Conditionally add analytics
    if (this.showFullAnalytics()) {
      sections.push({ id: 'analytics', title: 'Analytics', component: 'AnalyticsComponent' });
    }

    // Conditionally add reports
    if (this.showReports()) {
      sections.push({ id: 'reports', title: 'Reports', component: 'ReportsComponent' });
    }

    return sections;
  });

  // Feature configuration object flag
  protected readonly chartConfig = this.featureFlagService.getObjectFlag<{
    type: 'line' | 'bar' | 'pie';
    animated: boolean;
    colors: string[];
  }>('chart-config', {
    type: 'line',
    animated: false,
    colors: ['#3b82f6', '#10b981', '#f59e0b'],
  });
}
```

**Template:**

```html
@for (section of dashboardSections(); track section.id) {
<div class="dashboard-section">
  <h2>{{ section.title }}</h2>

  @switch (section.id) { @case ('overview') {
  <app-overview></app-overview>
  } @case ('analytics') {
  <app-analytics [config]="chartConfig()"></app-analytics>
  } @case ('reports') {
  <app-reports></app-reports>
  } }
</div>
}
```

**Use Cases:**

- **Feature Dependencies**: Only show analytics when charts are enabled
- **Complex Configurations**: Use object flags for multi-option settings
- **Dynamic Layouts**: Build dashboard sections based on multiple flags
- **Gradual Rollouts**: Enable features incrementally with dependent flags

## 🔍 Troubleshooting

### Flags Not Updating in Real-Time

**Symptom:** Flag changes in LaunchDarkly dashboard don't reflect in the application

**Possible Causes:**

1. **Streaming Disabled:**

   ```typescript
   // Check provider configuration
   streaming: true; // Must be true for real-time updates
   ```

2. **Browser Not Connected:**
   - Open browser DevTools → Network tab
   - Look for SSE connection to `clientstream.launchdarkly.com`
   - Should show "pending" status (persistent connection)

3. **Event Handlers Not Set Up:**

   ```typescript
   // Verify setupEventHandlers() was called
   console.log('Initialized:', this.featureFlagService.initialized());
   ```

**Solution:**

- Ensure `streaming: true` in provider configuration
- Check browser console for connection errors
- Verify user context was set correctly
- Test with network throttling disabled

### LaunchDarkly Client ID Not Configured

**Symptom:** Console warning "LaunchDarkly client ID not configured - feature flags disabled"

**Possible Causes:**

1. **Missing Environment Variable:**

   ```typescript
   // Check environment.ts
   launchDarklyClientId: 'your-client-id-here';
   ```

2. **Wrong Environment File:**
   - Development uses `environment.ts`
   - Production uses `environment.prod.ts`
   - Verify correct file has the client ID

**Solution:**

1. Add client ID to appropriate environment file
2. Restart development server (`yarn dev`)
3. Rebuild for production (`yarn build`)

### SSR vs Client-Side Initialization Timing

**Symptom:** Service initialized on server but not client, or vice versa

**Possible Causes:**

1. **Missing Browser Check:**

   ```typescript
   // Provider must check for browser environment
   if (typeof window === 'undefined') {
     return;
   }
   ```

2. **Initialization Too Early:**
   - Service must initialize **after** authentication
   - User context required for targeting

**Solution:**

- Verify browser check in `feature-flag.provider.ts`
- Initialize in `app.component` constructor, not earlier
- Confirm user object exists before calling `initialize()`

### Context Not Set Properly for Targeting

**Symptom:** Targeting rules in LaunchDarkly don't work as expected

**Possible Causes:**

1. **Missing Targeting Key:**

   ```typescript
   // targetingKey is required for user identification
   targetingKey: user.preferred_username || user.username || user.sub || '';
   ```

2. **Incorrect Attribute Names:**
   - LaunchDarkly is case-sensitive
   - Custom attributes must match targeting rules exactly

**Solution:**

1. Verify targeting key is unique and consistent
2. Check custom attributes match LaunchDarkly rules
3. Test targeting rules in LaunchDarkly dashboard
4. Use LaunchDarkly debugger to see evaluation results

### Flags Return Default Values

**Symptom:** All flags return default values, never true values from LaunchDarkly

**Possible Causes:**

1. **Service Not Initialized:**

   ```typescript
   // Check initialization status
   console.log('Initialized:', this.featureFlagService.initialized());
   ```

2. **Wrong Flag Key:**
   - Flag keys are case-sensitive
   - Must match exactly in LaunchDarkly dashboard

3. **Initialization Failed:**
   - Check browser console for errors
   - Network issues during initialization

**Solution:**

- Verify `initialized()` signal returns `true`
- Check flag keys match LaunchDarkly exactly
- Look for initialization errors in console
- Test with simplified flag (no targeting rules)

### Debugging Tips

**Enable Debug Logging (Development):**

```typescript
// feature-flag.provider.ts
logger: basicLogger({ level: 'debug' }), // Most verbose
```

**Check Initialization Status:**

```typescript
// In any component
constructor() {
  const flagService = inject(FeatureFlagService);
  console.log('Flag service initialized:', flagService.initialized());

  // Watch for initialization
  effect(() => {
    console.log('Initialized changed:', flagService.initialized());
  });
}
```

**Verify User Context:**

```typescript
// After initialization
const client = OpenFeature.getClient();
const context = await OpenFeature.getContext();
console.log('Current context:', context);
```

**Test Flag Evaluation:**

```typescript
// Manual flag evaluation
const client = OpenFeature.getClient();
const value = client.getBooleanValue('test-flag', false);
console.log('Flag value:', value);
```

**LaunchDarkly Dashboard Debugging:**

1. Navigate to your project in LaunchDarkly
2. Click on a flag → "Debugger" tab
3. See real-time evaluation results for each user
4. Verify targeting rules are evaluating correctly

## 🔗 Related Documentation

- **[State Management](./state-management.md)** - Angular signals and reactive patterns
- **[Angular Patterns](./angular-patterns.md)** - Zoneless change detection and modern Angular
- **[Component Architecture](./component-architecture.md)** - Component design and organization
- **[Authentication](../backend/authentication.md)** - User context and Auth0 integration
- **[Environment Configuration](../../../CLAUDE.md#environment-configuration)** - Environment variables and setup

### External Resources

- **[OpenFeature Documentation](https://openfeature.dev/)** - OpenFeature specification and SDKs
- **[LaunchDarkly JavaScript SDK](https://docs.launchdarkly.com/sdk/client-side/javascript)** - LaunchDarkly client SDK
- **[Angular Signals Guide](https://angular.dev/guide/signals)** - Official Angular signals documentation
- **[LaunchDarkly Targeting](https://docs.launchdarkly.com/home/flags/targeting)** - Targeting rules and strategies

---

**Last Updated:** 2025-11-17
**Version:** 1.0.0

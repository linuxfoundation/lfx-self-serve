# State Management

## 🎯 Angular Signals Architecture

The application uses Angular Signals as the primary state management solution, providing reactive programming without the complexity of RxJS for simple data flows.

## 🔄 Service-Based State Pattern

### Core Pattern

```typescript
@Injectable({ providedIn: "root" })
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
  public readonly activeData = computed(() =>
    this.dataSignal().filter((item) => item.is_active),
  );

  public readonly dataCount = computed(() => this.dataSignal().length);

  // Actions that update state
  public updateData(newData: Data[]): void {
    this.dataSignal.set(newData);
  }

  public setLoading(loading: boolean): void {
    this.loadingSignal.set(loading);
  }

  public setError(error: string | null): void {
    this.errorSignal.set(error);
  }
}
```

### Benefits

- **Reactive Updates**: Components automatically re-render when signals change
- **Type Safety**: Full TypeScript support with proper typing
- **Performance**: Efficient change detection without Zone.js
- **Simplicity**: Easier to understand than RxJS for simple state
- **Debugging**: Clear state flow and mutations

## 👤 User State Management

### UserService Pattern

```typescript
@Injectable({ providedIn: "root" })
export class UserService {
  // Authentication state
  private readonly authenticatedSignal = signal<boolean>(false);
  private readonly userSignal = signal<User | null>(null);

  // Public readonly signals
  public readonly authenticated = this.authenticatedSignal.asReadonly();
  public readonly user = this.userSignal.asReadonly();

  // Computed user information
  public readonly userDisplayName = computed(() => {
    const user = this.userSignal();
    return user ? `${user.given_name} ${user.family_name}` : "";
  });

  public readonly userInitials = computed(() => {
    const user = this.userSignal();
    if (!user) return "";

    const firstInitial = user.given_name?.charAt(0) || "";
    const lastInitial = user.family_name?.charAt(0) || "";
    return `${firstInitial}${lastInitial}`.toUpperCase();
  });

  // Actions
  public setAuthenticated(authenticated: boolean): void {
    this.authenticatedSignal.set(authenticated);
  }

  public setUser(user: User | null): void {
    this.userSignal.set(user);
  }

  public logout(): void {
    this.authenticatedSignal.set(false);
    this.userSignal.set(null);
  }
}
```

## 🧩 Component Integration

### Signal Consumption

```typescript
@Component({
  selector: "lfx-user-profile",
  template: `
    @if (userService.authenticated()) {
      <div class="user-profile">
        <lfx-avatar
          [image]="userService.user()?.picture"
          [label]="userService.userDisplayName()"
          [shape]="'circle'"
        >
        </lfx-avatar>

        <div class="user-info">
          <h3>{{ userService.user()?.name }}</h3>
          <p>{{ userService.user()?.email }}</p>
        </div>
      </div>
    } @else {
      <div>Please log in</div>
    }
  `,
})
export class UserProfileComponent {
  protected readonly userService = inject(UserService);
}
```

### Local Component State

```typescript
@Component({
  selector: "lfx-project-list",
  template: `
    @if (loading()) {
      <div>Loading projects...</div>
    } @else if (error()) {
      <div class="error">{{ error() }}</div>
    } @else {
      <div class="project-grid">
        @for (project of filteredProjects(); track project.id) {
          <lfx-project-card
            [title]="project.name"
            [description]="project.description"
          >
          </lfx-project-card>
        }
      </div>
    }

    <lfx-button
      [label]="'Load More'"
      [loading]="loading()"
      (onClick)="loadMoreProjects()"
    >
    </lfx-button>
  `,
})
export class ProjectListComponent {
  private readonly projectService = inject(ProjectService);

  // Local state
  private readonly filterSignal = signal<string>("");

  // Service state
  protected readonly projects = this.projectService.projects;
  protected readonly loading = this.projectService.loading;
  protected readonly error = this.projectService.error;

  // Computed state
  protected readonly filteredProjects = computed(() => {
    const filter = this.filterSignal().toLowerCase();
    const projects = this.projects();

    if (!filter) return projects;

    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(filter) ||
        project.description.toLowerCase().includes(filter),
    );
  });

  // Actions
  protected updateFilter(filter: string): void {
    this.filterSignal.set(filter);
  }

  protected loadMoreProjects(): void {
    this.projectService.loadMoreProjects();
  }
}
```

## 🔄 Data Flow Patterns

### Unidirectional Data Flow

```text
User Action → Component Method → Service Action → Signal Update → UI Update
```

### Example Flow

1. User clicks "Load Projects" button
2. Component calls `projectService.loadProjects()`
3. Service sets `loading.set(true)`
4. Service makes HTTP request
5. On success: `projects.set(data)`, `loading.set(false)`
6. On error: `error.set(message)`, `loading.set(false)`
7. Components automatically re-render with new state

## 📡 Async State Management

### HTTP Requests with Signals

```typescript
@Injectable({ providedIn: "root" })
export class ProjectService {
  private readonly http = inject(HttpClient);

  private readonly projectsSignal = signal<Project[]>([]);
  private readonly loadingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<string | null>(null);

  public readonly projects = this.projectsSignal.asReadonly();
  public readonly loading = this.loadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();

  public async loadProjects(): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const projects = await firstValueFrom(
        this.http.get<Project[]>("/api/projects"),
      );
      this.projectsSignal.set(projects);
    } catch (error) {
      this.errorSignal.set("Failed to load projects");
      console.error("Error loading projects:", error);
    } finally {
      this.loadingSignal.set(false);
    }
  }
}
```

### Signal + RxJS Integration (when needed)

```typescript
@Injectable({ providedIn: "root" })
export class RealtimeService {
  private readonly dataSignal = signal<RealtimeData[]>([]);

  public readonly data = this.dataSignal.asReadonly();

  constructor() {
    // Use RxJS for complex async operations
    this.setupRealtimeConnection();
  }

  private setupRealtimeConnection(): void {
    const websocket$ = webSocket<RealtimeData>("ws://localhost:8080");

    websocket$
      .pipe(
        takeUntilDestroyed(), // Angular 16+ pattern
      )
      .subscribe({
        next: (data) => {
          // Update signal from RxJS stream
          this.dataSignal.update((current) => [...current, data]);
        },
        error: (error) => {
          console.error("WebSocket error:", error);
        },
      });
  }
}
```

## 🎛 State Composition

### Combining Multiple Services

```typescript
@Component({
  selector: "lfx-dashboard",
  template: `
    <div class="dashboard">
      @if (userService.authenticated()) {
        <div class="welcome">Welcome, {{ userService.user()?.name }}!</div>

        @if (projectService.loading()) {
          <div>Loading projects...</div>
        } @else {
          <div class="stats">
            <div>Total Projects: {{ projectService.projectCount() }}</div>
            <div>
              Active Projects: {{ projectService.activeProjectCount() }}
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class DashboardComponent {
  protected readonly userService = inject(UserService);
  protected readonly projectService = inject(ProjectService);

  constructor() {
    // Load data when component initializes
    if (this.userService.authenticated()) {
      this.projectService.loadProjects();
    }
  }
}
```

## 🔧 Advanced Patterns

### Signal Effects

```typescript
export class ComponentWithEffects {
  private readonly filterSignal = signal<string>("");
  private readonly projectService = inject(ProjectService);

  constructor() {
    // React to filter changes
    effect(() => {
      const filter = this.filterSignal();
      if (filter) {
        // Side effect when filter changes
        this.projectService.filterProjects(filter);
      }
    });
  }
}
```

### Cross-Component Communication

```typescript
// Event bus service for complex component communication
@Injectable({ providedIn: "root" })
export class EventBusService {
  private readonly eventsSignal = signal<AppEvent[]>([]);

  public readonly events = this.eventsSignal.asReadonly();

  public emit(event: AppEvent): void {
    this.eventsSignal.update((events) => [...events, event]);
  }

  public clear(): void {
    this.eventsSignal.set([]);
  }
}
```

## 📊 Best Practices

1. **Keep signals simple**: Use signals for straightforward state, RxJS for complex async operations
2. **Use readonly signals**: Expose only readonly versions of signals from services
3. **Computed signals for derived data**: Always compute derived state instead of storing it
4. **Service-based state**: Keep state in services, not components
5. **Single responsibility**: Each service should manage one domain of state
6. **Error handling**: Always handle loading and error states
7. **Type safety**: Use proper TypeScript interfaces for all state
8. **Performance**: Use computed signals to avoid unnecessary recalculations

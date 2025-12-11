# Component Architecture

## 📁 Module File Organization

The project follows a modular file organization pattern where components are organized by their functional area:

### Module Structure

```text
apps/lfx-one/src/app/modules/project/
├── dashboard/                  # Project overview section
│   └── project-dashboard/      # Main dashboard route component
├── meetings/                   # Meetings management section
│   ├── meeting-dashboard/      # Main meetings route component
│   └── components/             # Meeting-specific components
│       ├── meeting-card/
│       ├── meeting-form/
│       ├── meeting-modal/
│       └── participant-list/
├── committees/                 # Committee management section
│   ├── committee-dashboard/    # Main committees route component
│   ├── committee-view/         # Committee detail route component
│   └── components/             # Committee-specific components
│       ├── committee-form/
│       ├── committee-members/
│       ├── member-card/
│       └── member-form/
├── mailing-lists/              # Mailing lists section
│   └── mailing-list-dashboard/ # Main mailing lists route component
└── settings/                   # Settings section
    ├── settings-dashboard/     # Main settings route component
    └── components/             # Settings-specific components
        └── user-permissions-table/
```

### Key Principles

1. **Section Organization**: Each major feature area (meetings, committees, etc.) has its own folder
2. **Route Components**: Components that have routes live directly in their section folder
3. **Shared Components Within Section**: Components used only within a section live in that section's `components` folder
4. **Truly Shared Components**: Only components used across multiple sections remain in `app/shared/components`

### Import Pattern

When importing section-specific components:

```typescript
// From within the same section (e.g., committee-view importing committee-form)
import { CommitteeFormComponent } from '../components/committee-form/committee-form.component';

// From another section (e.g., project dashboard importing committee-form)
import { CommitteeFormComponent } from '../../committees/components/committee-form/committee-form.component';

// Truly shared components still use the alias
import { ButtonComponent } from '@app/shared/components/button/button.component';
```

### Component Placement Guidelines

When creating new components, follow these guidelines:

1. **Route Components**: If the component has its own route, place it directly in the section folder
2. **Section-Specific Components**: If used only within one section, place in that section's `components` folder
3. **Cross-Section Components**: If used across multiple sections, place in `app/shared/components`
4. **UI Wrapper Components**: Generic UI components (buttons, cards, etc.) always go in `app/shared/components`

## 🎯 PrimeNG Component Wrapper Strategy

All PrimeNG components are abstracted through LFX wrapper components for UI library independence and consistent API.

### Wrapper Philosophy

```text
Application Code → LFX Wrapper → PrimeNG Component → DOM
    └── Clean API    └── Abstraction  └── UI Library    └── Rendered UI
```

### Benefits

1. **UI Library Independence**: Easy migration from PrimeNG to other libraries
2. **Consistent API**: All components follow Angular signals pattern
3. **Type Safety**: Proper TypeScript interfaces and validation
4. **Template Flexibility**: Full support for all PrimeNG template options
5. **Brand Consistency**: LFX-specific styling and behavior

## 🧩 Current Wrapper Components

### AvatarComponent (`lfx-avatar`)

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

### MenuComponent (`lfx-menu`)

**Enhanced Features**: Programmatic control with `toggle()`, `show()`, `hide()` methods

```html
<!-- Popup menu with programmatic control -->
<lfx-avatar (onClick)="userMenu.toggle($event)"></lfx-avatar>
<lfx-menu #userMenu [model]="userMenuItems" [popup]="true"></lfx-menu>
```

**Public API Methods**:

```typescript
// MenuComponent exposes PrimeNG's programmatic control
public toggle(event?: Event): void
public show(event?: Event): void
public hide(): void
```

### BadgeComponent (`lfx-badge`)

**Template Support**: None (property-based component)

**Features**: Simple wrapper for PrimeNG Badge with type-safe properties

```html
<lfx-badge [value]="'42'" [severity]="'success'" [size]="'large'"></lfx-badge>
```

**Properties**:

- `value: string` - Badge text content
- `severity: 'success' | 'info' | 'warning' | 'danger' | 'help' | 'primary' | 'secondary'`
- `size: 'small' | 'large' | 'xlarge'`

### ButtonComponent (`lfx-button`)

**Template Support**: Content projection via `<ng-content>` (PrimeNG Button doesn't support pTemplate)

```html
<!-- Using properties for standard buttons -->
<lfx-button [label]="'Save'" [icon]="'fa-light fa-save'" [severity]="'primary'" [loading]="isLoading()" (onClick)="handleSave($event)"> </lfx-button>

<!-- Using content projection for custom button content -->
<lfx-button [outlined]="true">
  <svg width="20" height="20" viewBox="0 0 20 20">
    <path d="..." fill="currentColor" />
  </svg>
  Custom Icon & Text
</lfx-button>
```

**Key Properties**:

- `label`, `icon`, `iconPos`
- `severity`, `raised`, `rounded`, `text`, `outlined`, `link`, `plain`
- `size`, `disabled`, `loading`, `loadingIcon`
- `badge`, `badgeClass`, `badgeSeverity`

### BreadcrumbComponent (`lfx-breadcrumb`)

**Template Support**: `item` (with MenuItem context), `separator`

```html
<lfx-breadcrumb [model]="breadcrumbItems()">
  <ng-template #item let-item>
    <a [routerLink]="item.routerLink">{{ item.label }}</a>
  </ng-template>
  <ng-template #separator>
    <i class="fa-light fa-angle-right"></i>
  </ng-template>
</lfx-breadcrumb>
```

### CardComponent (`lfx-card`)

**Template Support**: `header`, `title`, `subtitle`, `footer`

```html
<lfx-card>
  <ng-template #header>
    <img src="header.jpg" alt="Header" />
  </ng-template>
  <ng-template #title>
    <h3>Custom Title</h3>
  </ng-template>
  <ng-template #subtitle>
    <p>Custom Subtitle</p>
  </ng-template>
  <p>Default content</p>
  <ng-template #footer>
    <button>Action</button>
  </ng-template>
</lfx-card>
```

### MenubarComponent (`lfx-menubar`)

**Template Support**: `start`, `end`, `item` (with MenuItem + root context)

```html
<lfx-menubar [model]="menuItems()">
  <ng-template #start>
    <div>Start content</div>
  </ng-template>
  <ng-template #end>
    <div>End content</div>
  </ng-template>
  <ng-template #item let-item let-root="root">
    <a [routerLink]="item.routerLink">{{ item.label }}</a>
  </ng-template>
</lfx-menubar>
```

### TableComponent (`lfx-table`)

**Template Support**: `header`, `body`, `footer`, `caption`, `summary`, `emptymessage`, `loading`, `loadingbody`, `groupheader`, `groupfooter`, `paginatorleft`, `paginatorright`, `paginatordropdownitem`

**Features**:

- **Full Template Support**: All PrimeNG Table templates are supported
- **Comprehensive Properties**: Pagination, sorting, filtering, selection, lazy loading
- **Event Handling**: Complete event coverage for table interactions
- **Performance**: Virtual scrolling and lazy loading support

```html
<lfx-table [value]="projects()" [paginator]="true" [rows]="10" [globalFilterFields]="['name', 'description']">
  <ng-template #header>
    <tr>
      <th>Name</th>
      <th>Description</th>
      <th>Status</th>
    </tr>
  </ng-template>

  <ng-template #body let-project let-rowIndex="rowIndex">
    <tr>
      <td>{{ project.name }}</td>
      <td>{{ project.description }}</td>
      <td>
        <lfx-badge [value]="project.status" [severity]="project.status === 'active' ? 'success' : 'warning'"> </lfx-badge>
      </td>
    </tr>
  </ng-template>

  <ng-template #emptymessage>
    <tr>
      <td colspan="3" class="text-center p-4">
        <i class="fa-light fa-inbox text-4xl text-gray-400 mb-2"></i>
        <p>No projects found</p>
      </td>
    </tr>
  </ng-template>

  <ng-template #paginatorleft let-state>
    <lfx-button [icon]="'fa-light fa-refresh'" [text]="true" (onClick)="refresh()"> </lfx-button>
  </ng-template>

  <ng-template #paginatorright let-state>
    <span class="text-sm text-gray-600"> Showing {{ state.first + 1 }} to {{ state.first + state.rows }} of {{ state.totalRecords }} </span>
  </ng-template>
</lfx-table>
```

## 🏗 Layout Components

### ProjectLayoutComponent

Provides consistent layout wrapper for project-related pages:

```typescript
@Component({
  selector: 'lfx-project-layout',
  template: `
    <div class="project-layout">
      <div class="project-header">
        <lfx-breadcrumb [model]="breadcrumbItems()"></lfx-breadcrumb>
        <h1>{{ projectTitle() }}</h1>
        <p>{{ projectDescription() }}</p>
      </div>

      <nav class="project-nav">
        @for (item of menuItems(); track item.label) {
          <a [routerLink]="item.routerLink" routerLinkActive="active">
            {{ item.label }}
          </a>
        }
      </nav>

      <main class="project-content">
        <ng-content></ng-content>
      </main>
    </div>
  `,
})
export class ProjectLayoutComponent {
  // Required inputs
  public readonly projectTitle = input.required<string>();
  public readonly projectDescription = input.required<string>();
  public readonly projectSlug = input.required<string>();

  // Computed navigation items
  public readonly menuItems = computed(() => [
    {
      label: 'Meetings',
      routerLink: `/project/${this.projectSlug()}/meetings`,
    },
    {
      label: 'Committees',
      routerLink: `/project/${this.projectSlug()}/committees`,
    },
    {
      label: 'Mailing Lists',
      routerLink: `/project/${this.projectSlug()}/mailing-lists`,
    },
  ]);
}
```

## 🎨 Component Development Pattern

### Template for New Wrapper Components

```typescript
@Component({
  selector: 'lfx-[component-name]',
  imports: [CommonModule, [PrimeNGModule]],
  templateUrl: './[component-name].component.html',
})
export class [ComponentName]Component {
  // Input signals for all PrimeNG properties
  public readonly [property] = input<[Type]>([defaultValue]);

  // Output signals for all PrimeNG events
  public readonly [event] = output<[EventType]>();

  // Template references for content projection
  @ContentChild('[templateName]', {
    static: false,
    descendants: false  // Critical for template scoping
  }) [templateName]Template?: TemplateRef<any>;

  // Event handlers
  protected handle[Event](event: [EventType]): void {
    this.[event].emit(event);
  }
}
```

### Template Projection Pattern

```html
<p-[component] [property]="property()" (event)="handleEvent($event)">
  <!-- For templates with context -->
  <ng-template #[templateName] let-[contextVar]="[contextVar]">
    <ng-container
      *ngTemplateOutlet="[templateName]Template || null; 
                         context: { $implicit: [contextVar] }">
    </ng-container>
  </ng-template>

  <!-- For templates without context -->
  <ng-template #[templateName] *ngIf="[templateName]Template">
    <ng-container *ngTemplateOutlet="[templateName]Template || null"></ng-container>
  </ng-template>

  <!-- For default content projection -->
  <ng-content></ng-content>
</p-[component]>
```

### Critical: Template Scoping with `descendants: false`

**Problem**: Angular's `@ContentChild` by default searches through all descendant elements, which can cause template conflicts when components are nested.

**Example of the Problem**:

```html
<lfx-card>
  <ng-template #header>Card Header</ng-template>
  <lfx-table>
    <ng-template #header>Table Header</ng-template>
    <!-- This conflicts! -->
  </lfx-table>
</lfx-card>
```

**Solution**: Always use `descendants: false` in all `@ContentChild` decorators:

```typescript
// ✅ Correct - only finds direct child templates
@ContentChild('header', { static: false, descendants: false }) headerTemplate?: TemplateRef<any>;

// ❌ Incorrect - searches all descendants, causing conflicts
@ContentChild('header', { static: false }) headerTemplate?: TemplateRef<any>;
```

This ensures:

- Each wrapper component only finds its own direct child templates
- Nested components don't interfere with parent templates
- Template scoping works as expected in complex component hierarchies

## 📚 Creating New Wrapper Components

### Research Phase

Before creating a wrapper, **always research the PrimeNG component thoroughly**:

1. **Study PrimeNG Documentation**: Visit the official PrimeNG documentation for the component
2. **Review Properties & Events**: Identify all available properties, events, and methods
3. **Identify Templates**: Check supported template options (`pTemplate` directives)
4. **Template Context**: Study what context data templates receive

### Implementation Steps

#### Step 1: Generate Component

```bash
# In the apps/lfx-one directory
ng generate component shared/components/[component-name] --standalone --skip-tests
```

#### Step 2: Define Input/Output Signals

```typescript
// Required inputs
public readonly requiredProperty = input.required<string>();

// Optional inputs with defaults
public readonly optionalProperty = input<boolean>(false);
public readonly arrayProperty = input<Item[]>([]);

// Union type inputs with defaults
public readonly severity = input<'success' | 'info' | 'warning' | 'danger'>('info');

// Events should match PrimeNG event names exactly
public readonly onClick = output<MouseEvent>();
public readonly onSelectionChange = output<SelectionChangeEvent>();
```

#### Step 3: Add Template References

```typescript
// For each pTemplate supported by the PrimeNG component
// CRITICAL: Always use descendants: false
@ContentChild('header', { static: false, descendants: false }) headerTemplate?: TemplateRef<any>;
@ContentChild('body', { static: false, descendants: false }) bodyTemplate?: TemplateRef<any>;
@ContentChild('item', { static: false, descendants: false }) itemTemplate?: TemplateRef<any>;
```

#### Step 4: Implement Event Handlers

```typescript
protected handleClick(event: MouseEvent): void {
  this.onClick.emit(event);
}

protected handleSelectionChange(event: SelectionChangeEvent): void {
  this.onSelectionChange.emit(event);
}
```

#### Step 5: Create Template with Proper Context

```html
<p-[component] [property1]="property1()" [property2]="property2()" (onClick)="handleClick($event)" (onSelectionChange)="handleSelectionChange($event)">
  <!-- Template outlets for each supported template -->
  <ng-template #header *ngIf="headerTemplate">
    <ng-container *ngTemplateOutlet="headerTemplate"></ng-container>
  </ng-template>

  <ng-template #item let-item let-index="index">
    <ng-container *ngTemplateOutlet="itemTemplate || null; context: { $implicit: item, index: index }"> </ng-container>
  </ng-template>

  <!-- Default content projection -->
  <ng-content></ng-content>
</p-[component]>
```

### Common Template Types

- **Layout Templates**: `header`, `footer`, `title`, `subtitle`
- **Item Templates**: `item`, `option`, `selectedItem` (receive context data)
- **Content Templates**: `start`, `end`, `content`
- **State Templates**: `empty`, `loading`, `error`
- **Navigation Templates**: `paginatorleft`, `paginatorright`, `summary`

## 📝 Development Checklist

### Research & Planning

- [ ] **Research**: Check PrimeNG documentation for all properties, events, and templates
- [ ] **Dependencies**: Identify required PrimeNG modules and imports
- [ ] **Context**: Understand template context structure from PrimeNG source

### Component Implementation

- [ ] **Component Selector**: Use `lfx-` prefix (enforced by ESLint)
- [ ] **Standalone Component**: Import dependencies explicitly
- [ ] **Input Signals**: Use `input()` and `input.required()` for properties with proper types
- [ ] **Output Signals**: Use `output()` for events with correct event types
- [ ] **Template References**: Use `@ContentChild()` for all template references
- [ ] **Template Scoping**: **CRITICAL** - Always use `descendants: false` in `@ContentChild()`
- [ ] **Context**: Ensure template context matches PrimeNG's structure exactly
- [ ] **Fallbacks**: Use `|| null` for template outlets to handle undefined cases

### Code Quality

- [ ] **Type Safety**: Import and use interfaces from `@lfx-one/shared` package
- [ ] **Event Handling**: Proper event emission and parameter passing
- [ ] **Error Handling**: Graceful handling of edge cases
- [ ] **Accessibility**: Include ARIA labels and roles where applicable

### Testing & Documentation

- [ ] **Component Import**: Import wrapper component directly, not through barrel exports
- [ ] **Usage Examples**: Create comprehensive usage examples
- [ ] **Template Testing**: Verify all templates work correctly
- [ ] **Nested Testing**: Test component works when nested with other wrappers
- [ ] **Build Verification**: Ensure build passes and no TypeScript errors
- [ ] **Documentation**: Update this documentation with usage examples

### Integration

- [ ] **Shared Interfaces**: Add any new interfaces to `@lfx-one/shared/interfaces`
- [ ] **Export Path**: Ensure component is exported correctly
- [ ] **Usage Guidelines**: Update project documentation
- [ ] **Component Hierarchy**: Verify component fits properly in app structure

## 🔄 Component Hierarchy

```text
AppComponent
├── HeaderComponent (global navigation with user menu)
│   ├── AvatarComponent (user profile picture)
│   └── MenuComponent (user dropdown menu)
└── RouterOutlet
    ├── HomeComponent
    │   └── ProjectCardComponent (multiple instances)
    └── ProjectLayoutComponent
        └── RouterOutlet (project sub-routes)
            ├── project/dashboard/
            │   └── ProjectDashboardComponent
            ├── project/meetings/
            │   ├── MeetingDashboardComponent
            │   └── components/
            │       ├── MeetingCardComponent
            │       ├── MeetingFormComponent
            │       └── ParticipantListComponent
            ├── project/committees/
            │   ├── CommitteeDashboardComponent
            │   ├── CommitteeViewComponent
            │   └── components/
            │       ├── CommitteeFormComponent
            │       ├── CommitteeMembersComponent
            │       └── MemberCardComponent
            ├── project/mailing-lists/
            │   └── MailingListDashboardComponent
            └── project/settings/
                ├── SettingsDashboardComponent
                └── components/
                    └── UserPermissionsTableComponent
```

## 🎯 Usage Guidelines

1. **Always use LFX wrapper components** instead of PrimeNG directly
2. **Import wrapper components directly** - no barrel exports
3. **Follow the established patterns** for consistency
4. **Use shared interfaces** for type safety
5. **Support template projection** for flexibility
6. **Maintain accessibility** standards
7. **Test component isolation** and integration
8. **Follow module organization** - place components in section-specific folders when appropriate
9. **Minimize shared components** - only truly cross-cutting components belong in shared/components

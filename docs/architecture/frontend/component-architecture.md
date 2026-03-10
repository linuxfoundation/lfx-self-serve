# Component Architecture

## 📁 Module File Organization

The project follows a modular file organization pattern where components are organized by their functional area:

### Module Structure

```text
apps/lfx-one/src/app/modules/
├── committees/                 # Committee management
│   ├── committee-dashboard/    # Main committees route component
│   ├── committee-view/         # Committee detail route component
│   └── components/             # Committee-specific components
├── dashboards/                 # Role-based dashboards
│   └── components/             # Dashboard-specific components (drawers, cards)
├── mailing-lists/              # Mailing lists section
│   └── mailing-list-dashboard/ # Main mailing lists route component
├── meetings/                   # Meetings management section
│   ├── meeting-dashboard/      # Main meetings route component
│   └── components/             # Meeting-specific components
├── my-activity/                # User activity tracking
├── profile/                    # User profile management
├── settings/                   # Application settings
│   ├── settings-dashboard/     # Main settings route component
│   └── components/             # Settings-specific components
├── surveys/                    # Survey management
└── votes/                      # Voting system
```

> **Note**: Routes are FLAT under `MainLayoutComponent` — there is no `/project/:slug` nesting.

### Key Principles

1. **Section Organization**: Each major feature area (meetings, committees, etc.) has its own folder
2. **Route Components**: Components that have routes live directly in their section folder
3. **Shared Components Within Section**: Components used only within a section live in that section's `components` folder
4. **Truly Shared Components**: Only components used across multiple sections remain in `apps/lfx-one/src/app/shared/components`

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

### Other Wrapper Components

Additional wrappers follow the same pattern: `BadgeComponent`, `ButtonComponent`, `BreadcrumbComponent`, `CardComponent`, `MenuComponent`, `MenubarComponent`, `TableComponent`. Each uses `input()` signals for properties, `output()` for events, and `@ContentChild` with `descendants: false` for template projection. See the source files in `app/shared/components/` for each wrapper's specific API.

## 🏗 Layout Components

### MainLayoutComponent

The primary layout component that wraps all authenticated routes. Routes are flat under this layout — there is no nested `/project/:slug` routing pattern.

### DevToolbarComponent

Development-only toolbar for persona selection and project switching. Includes board member project override functionality.

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
- [ ] **Accessibility**: Include ARIA labels and roles where applicable
- [ ] **Nested Testing**: Test component works when nested with other wrappers
- [ ] **Build Verification**: Ensure build passes and no TypeScript errors

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

---
type: Decision
title: PrimeNG Component Wrapper Pattern
description: All PrimeNG components wrapped in LFX components for UI library independence and consistent API.
resource: docs/architecture/frontend/component-architecture.md
tags: [architecture, frontend, components]
---

## Context and Rationale

The application uses **PrimeNG** as the underlying UI component library but **does not expose PrimeNG directly** to application code. Instead, all PrimeNG components are wrapped in **LFX wrapper components** that provide a clean, stable API independent of the underlying UI library.

### The Abstraction Layer

```
Application Code
    ↓
LFX Wrapper Components (e.g., lfx-button, lfx-dialog)
    ↓
PrimeNG Components (p-button, p-dialog, etc.)
    ↓
DOM
```

### Why This Pattern

**UI Library Independence:**

- The application is decoupled from PrimeNG's API
- If PrimeNG is replaced with another library (e.g., NgBootstrap, Material), only the wrappers change
- Application code remains stable

**Consistent API:**

- Wrappers provide a single, vetted interface for each component
- Reduces cognitive load — developers use `lfx-button` everywhere, not three different PrimeNG button variants
- Enforces design system constraints (e.g., button sizes are limited to approved values)

**Easier Maintenance:**

- Shared component behavior (loading states, error handling, accessibility) is centralized in wrappers
- Bug fixes to a wrapper automatically benefit all uses
- Design system updates are rolled out consistently

**Type Safety:**

- Wrappers define strict TypeScript interfaces aligned with the design system
- Prevents misuse of the underlying component library
- Better IDE autocomplete and error detection

## Architecture

### Wrapper Component Example

A wrapper component mirrors the PrimeNG component but with a simplified, intentional API:

```typescript
// apps/lfx-one/src/app/shared/components/button/button.component.ts
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ButtonModule } from 'primeng/button';

export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

@Component({
  selector: 'lfx-button',
  imports: [ButtonModule],
  template: `
    <button
      pButton
      [type]="type"
      [disabled]="disabled"
      [ngClass]="sizeClass"
      [class]="variantClass"
      (click)="onClick.emit()"
    >
      {{ label }}
    </button>
  `,
  styleUrl: './button.component.scss',
})
export class ButtonComponent {
  @Input() label: string = '';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() size: ButtonSize = 'md';
  @Input() variant: ButtonVariant = 'primary';
  @Input() disabled: boolean = false;
  @Output() onClick = new EventEmitter<void>();

  get sizeClass() {
    return { 'p-button-sm': this.size === 'sm', 'p-button-lg': this.size === 'lg' };
  }

  get variantClass() {
    return {
      'p-button-primary': this.variant === 'primary',
      'p-button-secondary': this.variant === 'secondary',
      'p-button-danger': this.variant === 'danger',
    };
  }
}
```

**Usage in application code:**

```typescript
// Application code never imports PrimeNG directly
import { ButtonComponent } from '@app/shared/components/button/button.component';

@Component({
  imports: [ButtonComponent],
  template: `
    <lfx-button
      label="Click me"
      variant="primary"
      size="md"
      (onClick)="handleClick()"
    />
  `,
})
export class MyComponent {
  handleClick() { /* ... */ }
}
```

### Component Organization

**Wrapper components live in:**

```
apps/lfx-one/src/app/shared/components/
├── button/
│   ├── button.component.ts
│   ├── button.component.scss
│   └── button.component.spec.ts
├── dialog/
├── dropdown/
├── table/
├── card/
└── ... (one folder per component)
```

**Section-specific components:**

Components used in a single feature module (e.g., `committees`) go in that module's `components/` folder and do not need to be wrappers (they are not reused across the UI library).

### Direct Imports (No Barrel Exports)

Components are imported directly, not through barrel exports:

```typescript
// ✓ Correct — direct import
import { ButtonComponent } from '@app/shared/components/button/button.component';

// ✗ Avoid — indirect via barrel export
import { ButtonComponent } from '@app/shared/components';
```

This pattern:

- Makes tree-shaking more efficient (unused components are dropped by the bundler)
- Reduces circular dependency risks
- Makes search and refactoring easier (you know exactly where `ButtonComponent` comes from)

## Trade-offs

### Abstraction Overhead

**Benefit:** UI library independence, consistent API, easier maintenance.

**Trade-off:** Wrappers add an extra layer of indirection. New wrapper components take time to implement and test. If the underlying library's API changes, the wrapper must be updated.

**Mitigation:** Wrapper implementations are kept simple; they expose only the features actually used by the application. For new components, the pattern is straightforward to follow.

### Sync Between Wrapper and PrimeNG

**Benefit:** The application stays shielded from PrimeNG API changes.

**Trade-off:** If PrimeNG releases a new feature, the wrapper must be updated to expose it (or developers must wait).

**Mitigation:** Wrapper updates are done proactively during component development. Critical PrimeNG features are surfaced immediately; nice-to-have features are prioritized in the design system roadmap.

## Key Implications for Development

1. **Never import PrimeNG directly** in application code — import LFX wrappers instead
2. **Create new wrappers when needed** — if you need a new component, wrap it first
3. **Reference PrimeNG interface definitions** — when creating wrappers, use PrimeNG component interfaces as a reference for the underlying behavior
4. **Keep wrapper APIs simple** — expose only what the app needs; avoid exposing all PrimeNG options
5. **Wrappers should be standalone components** — all use the `standalone: true` pattern and direct imports

## Related Concepts

- [Angular Zoneless SSR](../decisions/angular-zoneless-ssr.md) — SSR implications for component wrappers (e.g., avoiding browser-only APIs)
- [Component Architecture](../modules/component-architecture.md) — module file organization and component placement

## Citations

- **Source:** `docs/architecture/frontend/component-architecture.md`, PrimeNG Component Wrapper Strategy section (lines 90–102)
- **Source:** `docs/architecture/frontend/component-architecture.md`, Key Principles subsection (lines 59–64)

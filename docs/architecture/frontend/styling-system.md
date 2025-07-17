# Styling System

## 🎨 CSS Layer Architecture

The application uses a sophisticated CSS layer system for optimal styling organization and cascade control.

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
const customPreset = definePreset(Aura, {
  primitive: lfxPreset.primitive,
  semantic: lfxPreset.semantic,
  components: lfxPreset.component,
});

providePrimeNG({
  theme: {
    preset: customPreset,
    options: {
      prefix: "p",
      darkModeSelector: ".dark-mode",
      cssLayer: {
        name: "primeng",
        order: "tailwind-base, primeng, tailwind-utilities",
      },
    },
  },
});
```

### Layer Benefits

1. **Proper CSS Cascade**: Ensures Tailwind utilities can override PrimeNG styles
2. **Predictable Specificity**: Layer order determines precedence regardless of selector specificity
3. **Maintainable Styles**: Clear separation of concerns between frameworks
4. **Performance**: Optimized CSS loading and parsing

## 🎯 LFX UI Core Integration

### Custom PrimeNG Preset

The application uses a custom PrimeNG preset based on LFX UI Core design tokens:

```typescript
// Custom preset configuration
const customPreset = definePreset(Aura, {
  primitive: lfxPreset.primitive, // Base design tokens
  semantic: lfxPreset.semantic, // Semantic color mappings
  components: lfxPreset.component, // Component-specific styles
});
```

### Design System Benefits

- **Consistent Branding**: LFX design tokens throughout the application
- **Accessible Colors**: WCAG compliant color combinations
- **Responsive Design**: Mobile-first responsive patterns
- **Dark Mode Support**: Built-in dark mode theming capabilities

## 🌈 Color System

### LFX Brand Colors

```typescript
// src/app/config/styles/colors.ts
export const lfxColors = {
  primary: {
    50: "#eff6ff",
    100: "#dbeafe",
    // ... full color scale
    900: "#1e3a8a",
  },
  secondary: {
    // ... secondary color scale
  },
  // ... additional brand colors
};
```

### Usage in Tailwind

```typescript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: lfxColors,
    },
  },
};
```

## 🔤 Font System

### Font Configuration

```scss
// Custom font theme variables
@theme {
  --font-sans: "Open Sans", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Roboto Slab", ui-serif, Georgia, serif;
  --font-serif: "Roboto Slab", ui-serif, Georgia, serif;
}
```

### Font Loading

Fonts are loaded via Google Fonts for optimal performance:

- **Open Sans**: Primary sans-serif font for body text
- **Roboto Slab**: Display font for headings and emphasis

### Custom Font Sizes

```typescript
// src/app/config/styles/font-size.ts
export const lfxFontSizes = {
  "2xs": ["0.625rem", { lineHeight: "0.75rem" }],
  xs: ["0.75rem", { lineHeight: "1rem" }],
  // ... additional sizes
};
```

## 🛠 Tailwind Configuration

### Core Configuration

```javascript
// tailwind.config.js
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: lfxColors,
      fontSize: lfxFontSizes,
      fontFamily: {
        sans: ["Open Sans", "sans-serif"],
        display: ["Roboto Slab", "serif"],
      },
    },
  },
  plugins: [require("@primeuix/tailwind-plugin")],
};
```

### PrimeUI Plugin Integration

The `@primeuix/tailwind-plugin` provides:

- Component utilities for PrimeNG components
- Consistent spacing and sizing
- Integrated design tokens
- Responsive utilities

## 🎨 Component Styling Guidelines

### Utility-First Approach

```html
<!-- Preferred: Utility classes -->
<div class="flex items-center gap-4 p-6 bg-white rounded-lg shadow-sm">
  <lfx-avatar [image]="user.picture" class="w-12 h-12"></lfx-avatar>
  <div class="flex-1">
    <h3 class="text-lg font-semibold text-gray-900">{{ user.name }}</h3>
    <p class="text-sm text-gray-600">{{ user.email }}</p>
  </div>
</div>
```

### Component-Specific Styles

When utilities aren't sufficient, use component-specific styles:

```scss
// component.scss
.custom-component {
  @apply relative overflow-hidden;

  &:hover {
    @apply shadow-lg transform scale-105;
    transition: all 0.2s ease-in-out;
  }

  .special-element {
    background: linear-gradient(
      45deg,
      theme("colors.primary.500"),
      theme("colors.secondary.500")
    );
  }
}
```

## 🎭 Icon System

### Font Awesome Pro

Icons are loaded via Font Awesome kits (not npm packages):

```html
<!-- Icon usage -->
<i class="fa-light fa-user"></i>
<i class="fa-solid fa-check"></i>
<i class="fa-regular fa-heart"></i>
```

### Icon Guidelines

- Use `fa-light` for most interface icons
- Use `fa-solid` for emphasis and CTAs
- Use `fa-regular` for secondary actions
- Maintain consistent icon sizing
- Provide accessible labels

## 🌓 Dark Mode Support

### Theme Configuration

```typescript
// PrimeNG dark mode selector
options: {
  darkModeSelector: '.dark-mode',
}
```

### Implementation

```html
<!-- Dark mode toggle -->
<button
  (click)="toggleDarkMode()"
  class="p-2 rounded-md dark:bg-gray-800 dark:text-white"
>
  <i class="fa-light fa-moon dark:fa-sun"></i>
</button>
```

## 📱 Responsive Design

### Breakpoint Strategy

```typescript
// Tailwind breakpoints
const breakpoints = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
};
```

### Responsive Patterns

```html
<!-- Mobile-first responsive design -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <lfx-project-card
    class="w-full"
    [title]="project.name"
    [description]="project.description"
  >
  </lfx-project-card>
</div>
```

## 🔧 Build Optimizations

### CSS Purging

Unused CSS is automatically removed in production builds:

```javascript
// tailwind.config.js
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  // Only CSS used in these files is included
};
```

### Critical CSS

Critical CSS is inlined for faster initial renders:

- Above-the-fold styles are prioritized
- Non-critical styles are loaded asynchronously
- Font loading is optimized with preload hints

## 📏 Design Tokens

### Spacing Scale

```typescript
// Consistent spacing throughout the application
const spacing = {
  0: "0px",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  // ... standard Tailwind scale
};
```

### Component Tokens

```typescript
// Component-specific design tokens
const tokens = {
  borderRadius: {
    sm: "0.125rem",
    DEFAULT: "0.25rem",
    md: "0.375rem",
    lg: "0.5rem",
  },
  boxShadow: {
    sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    DEFAULT: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
    // ... elevation scale
  },
};
```

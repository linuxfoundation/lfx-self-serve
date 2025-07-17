# Frontend Architecture

## 🎨 Overview

The LFX PCC frontend is built with Angular 19 using experimental zoneless change detection, Angular Signals for state management, and a comprehensive design system based on PrimeNG and Tailwind CSS.

## 🏗 Architecture Components

### Core Framework

- **Angular 19** with experimental zoneless change detection
- **Angular Signals** for reactive state management (preferred over RxJS)
- **Server-Side Rendering (SSR)** with AngularNodeAppEngine
- **Standalone Components** with explicit imports

### UI System

- **PrimeNG 19** with custom LFX UI Core preset
- **Tailwind CSS v3** with PrimeUI plugin integration
- **CSS Layers** architecture for optimal style cascade
- **LFX Tools** web component for platform navigation

### State Management

- **Angular Signals** for component and service state
- **Service-based patterns** with computed signals
- **Reactive data flow** without Zone.js dependency

## 📋 Documentation Sections

### [Angular Patterns](./angular-patterns.md)

Learn about Angular 19 features, zoneless change detection, and SSR configuration.

### [Component Architecture](./component-architecture.md)

Understand PrimeNG wrapper components, layout patterns, and component hierarchy.

### [Styling System](./styling-system.md)

Explore CSS layers, Tailwind configuration, and LFX UI Core integration.

### [State Management](./state-management.md)

Master Angular Signals patterns and service-based state management.

### [Performance](./performance.md)

Discover SSR benefits, build optimizations, and performance strategies.

## 🚀 Key Features

- **Zoneless Change Detection**: Better performance without Zone.js
- **Signal-First Architecture**: Reactive programming with Angular Signals
- **Component Wrapper System**: Abstracted PrimeNG components for consistency
- **Design System Integration**: LFX UI Core with custom theming
- **Modern Development**: TypeScript strict mode, ESLint, Prettier

## 🔗 Quick Links

- [Getting Started Guide](../../../CLAUDE.md#angular-19-development-patterns)
- [Component Development Checklist](./component-architecture.md#development-checklist)
- [Styling Guidelines](./styling-system.md#styling-guidelines)

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📋 Table of Contents

### 🏗 Architecture & Setup

- [Project Overview](#project-overview) - Turborepo monorepo with Angular 19 SSR
- [Monorepo Structure](#monorepo-structure) - Apps, packages, and organization
- [Application Architecture](#application-architecture) - Directory structure and patterns
- [Common Commands](#common-commands) - Development and production commands

### 🚀 Development Patterns

- [Angular 19 Development Patterns](#angular-19-development-patterns) - Zoneless change detection, signals, components
- [Shared Package (@lfx-pcc/shared)](#shared-package-lfx-pccshared) - Types, interfaces, constants
- [PrimeNG Component Wrappers](#primeng-component-wrappers) - UI library abstraction
- [Path Mappings](#path-mappings) - Import aliases and conventions

### 🎨 UI & Layout

- [CSS Architecture & Styling](#css-architecture--styling) - Tailwind, fonts, theming

### 🔧 Technical Stack

- [Frontend Technologies](#frontend-technologies) - Angular 19, PrimeNG, Tailwind
- [Backend Stack](#backend-stack) - Express.js server with SSR
- [Development Tools](#development-tools) - ESLint, Prettier, Turborepo
- [Code Quality](#code-quality) - Linting and formatting standards

### 🚀 Operations

- [Authentication & Authorization](#authentication--authorization) - Auth0 integration
- [Logging](#logging) - Pino structured logging
- [Server-Side Rendering (SSR)](#server-side-rendering-ssr) - Angular 19 built-in SSR
- [Production Deployment](#production-deployment) - PM2, health checks
- [Testing](#testing) - Test framework and commands
- [Environment Configuration](#environment-configuration) - Dev/prod setup

### 📚 Documentation Links

- [Component Architecture](docs/architecture/frontend/component-architecture.md) - Detailed wrapper patterns
- [Angular Patterns](docs/architecture/frontend/angular-patterns.md) - Angular 19 development
- [Styling System](docs/architecture/frontend/styling-system.md) - CSS and theming
- [Authentication](docs/architecture/backend/authentication.md) - Auth0 setup
- [SSR Server](docs/architecture/backend/ssr-server.md) - Server-side rendering
- [Logging & Monitoring](docs/architecture/backend/logging-monitoring.md) - Structured logging

### 💡 Quick Reference

- [Application Flow](#application-flow) - User journey and navigation
- [Current State & Development Roadmap](#current-state--development-roadmap) - Implementation status
- [Development Memories](#development-memories) - Important reminders and patterns

## Project Overview

LFX PCC is a Turborepo monorepo containing an Angular 19 SSR application with experimental zoneless change detection and Express.js server.

## Monorepo Structure

```text
lfx-pcc-v3/
├── apps/
│   └── lfx-pcc/              # Angular 19 SSR application with zoneless change detection
│       ├── eslint.config.mjs # Angular-specific ESLint rules
│       ├── .prettierrc       # Prettier configuration with Tailwind integration
│       └── tailwind.config.js # Tailwind with PrimeUI plugin and LFX colors
├── packages/
│   └── shared/               # Shared types, interfaces, constants, and enums
│       ├── src/
│       │   ├── interfaces/   # TypeScript interfaces for components, auth, projects
│       │   ├── constants/    # Design tokens (colors, font-sizes)
│       │   └── enums/        # Shared enumerations
│       ├── package.json      # Package configuration with proper exports
│       └── tsconfig.json     # TypeScript configuration
├── docs/                     # Architecture and deployment documentation
├── turbo.json               # Turborepo pipeline configuration
├── ecosystem.config.js      # PM2 production configuration
└── package.json             # Root workspace configuration
```

[... rest of the existing content remains unchanged ...]

## Development Memories

- Always reference PrimeNG's component interface when trying to define types
- The project logo display is currently hardcoded but will be dynamic once API is integrated
- Metrics data is hardcoded but structured to match future API responses
- All PrimeNG components are wrapped in LFX components for UI library independence
- Always use direct imports for standalone components - no barrel exports
- Authentication is handled by Auth0 with express-openid-connect middleware
- Logging uses Pino for structured JSON logs with sensitive data redaction
- Health checks are available at /health and are not logged or authenticated
- All shared types, interfaces, and constants are centralized in @lfx-pcc/shared package
- Use TypeScript interfaces instead of union types for better maintainability
- Shared package uses direct source imports during development for hot reloading
- **Interfaces go into the shared packages**

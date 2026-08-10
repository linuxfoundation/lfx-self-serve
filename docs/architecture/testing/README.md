# Testing Architecture

## 🧪 Overview

The testing architecture is designed to ensure code quality and reliability across the monorepo with comprehensive testing strategies for frontend, backend, and shared packages.

## 🏗 Testing Strategy

### Testing Approach

- **Unit Tests**: Vitest, in two halves — `src/server/**` under Node, `src/app/**` under jsdom via the Angular `unit-test` builder
- **End-to-End Tests**: Full application workflow testing with Playwright
- **Dual Architecture**: Content-based tests for user experience + Structural tests for technical validation

### Key Principles

- **Dual Test Architecture**: Content-based + Structural tests for maximum reliability
- **Binding Tests**: A new test is verified by mutating the code it covers and confirming it fails — a green test proves nothing on its own
- **Data-TestID Strategy**: Robust element targeting that survives UI changes
- **Responsive Testing**: Multi-viewport validation (mobile, tablet, desktop)
- **Framework-Aware Testing**: Angular signals, components, and architecture validation
- **Fast Feedback**: Quick test execution for development
- **Reliable Tests**: Consistent and deterministic test results
- **Comprehensive Coverage**: Critical paths and edge cases covered

## 📋 Documentation Sections

### [Unit Testing](./unit-testing.md)

The two Vitest halves, the Angular `unit-test` builder, zoneless TestBed setup, and how to verify a new test actually binds.

### [E2E Testing](./e2e-testing.md)

Comprehensive end-to-end testing with dual architecture approach, covering user workflows, component validation, and browser automation.

### [Testing Best Practices](./testing-best-practices.md)

Complete guide to testing patterns, data-testid conventions, responsive testing, and maintenance strategies.

## 🚀 Testing Tools

### Primary Testing Frameworks

- **Vitest**: Unit test runner for both the server (Node) and app (jsdom) halves
- **Playwright**: Modern browser automation framework
- **Multi-browser Support**: Chromium, Firefox, Mobile Chrome
- **Data-TestID Architecture**: Robust element targeting that survives UI changes
- **Dual Testing Strategy**: Content-based + Structural tests for comprehensive coverage

### Supporting Tools

- **Auth0 Integration**: Global authentication setup for testing
- **Responsive Testing**: Multi-viewport validation
- **Angular Integration**: Signals, components, and framework-specific validation

## Quick Links

- [Angular Testing Guide](https://angular.dev/guide/testing)
- [Playwright Documentation](https://playwright.dev/)

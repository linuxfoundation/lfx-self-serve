# Testing Architecture

## 🧪 Overview

The testing architecture is designed to ensure code quality and reliability across the monorepo with comprehensive testing strategies for frontend, backend, and shared packages.

## 🏗 Testing Strategy

### Testing Approach

- **End-to-End Tests**: Full application workflows with comprehensive coverage (85+ tests)
- **Dual Architecture**: Content-based tests for user experience + Structural tests for technical validation

### Key Principles

- **Dual Test Architecture**: Content-based + Structural tests for maximum reliability
- **Data-TestID Strategy**: Robust element targeting that survives UI changes
- **Responsive Testing**: Multi-viewport validation (mobile, tablet, desktop)
- **Framework-Aware Testing**: Angular signals, components, and architecture validation
- **Fast Feedback**: Quick test execution for development
- **Reliable Tests**: Consistent and deterministic test results
- **Comprehensive Coverage**: Critical paths and edge cases covered

## 📋 Documentation Sections

### [E2E Testing](./e2e-testing.md)

Comprehensive end-to-end testing with dual architecture approach, covering user workflows, component validation, and browser automation.

### [Testing Best Practices](./testing-best-practices.md)

Complete guide to testing patterns, data-testid conventions, responsive testing, and maintenance strategies.

## 🚀 Testing Tools

### Primary Testing Framework

- **Playwright**: Modern browser automation framework
- **Multi-browser Support**: Chromium, Firefox, Mobile Chrome
- **Data-TestID Architecture**: Robust element targeting that survives UI changes
- **Dual Testing Strategy**: Content-based + Structural tests for comprehensive coverage

### Supporting Tools

- **Auth0 Integration**: Global authentication setup for testing
- **Responsive Testing**: Multi-viewport validation
- **Angular Integration**: Signals, components, and framework-specific validation

## 🔗 Quick Links

- [Angular Testing Guide](https://angular.io/guide/testing)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Playwright Documentation](https://playwright.dev/)

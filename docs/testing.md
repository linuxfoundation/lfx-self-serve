# Testing Guide for v1-changelog

## Overview

This document provides a comprehensive guide to testing the v1-changelog
application, including setup, execution, and maintenance of both unit and
end-to-end tests. The testing suite is built with Cypress for E2E testing and
uses Angular's built-in testing tools for unit tests.

## Table of Contents

1. [Test Architecture](#test-architecture)
2. [End-to-End Testing with Cypress](#end-to-end-testing-with-cypress)
3. [Test Data Management](#test-data-management)
4. [Testing Components](#testing-components)
5. [Data-Test Attributes Reference](#data-test-attributes-reference)
6. [API Testing](#api-testing)
7. [Running Tests](#running-tests)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

## Test Architecture

### Testing Stack

- **E2E Testing**: Cypress 14.2.0
- **Unit Testing**: Angular Testing Utilities + Jasmine + Karma
- **Authentication**: Auth0 integration with session management
- **API Mocking**: Cypress intercepts with fixtures
- **Data Management**: JSON fixtures and database seeding

### Test Structure

```text
cypress/
├── e2e/
├── fixtures/                # Test data
├── support/                 # Custom commands and utilities
└── DATA_TEST_ATTRIBUTES.md  # Test selector reference
```

### Fixtures

Test data is managed through JSON fixtures:

### API Mocking Strategy

Tests use Cypress intercepts to mock API responses:

```typescript
// Example API mocking setup
cy.fixture('managers').then((managers) => {
  cy.intercept('GET', '/api/managers*', managers).as('getManagers');
});

// Override for empty state testing
cy.intercept('GET', '/api/managers', {
  statusCode: 200,
  body: [],
}).as('getEmptyManagers');
```

## Testing Components

### Data-Test Attributes

All testable elements use `data-test` attributes for reliable selection:

```html
<!-- Navigation -->
<a data-test="nav-changelog">Changelog</a>
<button data-test="create-changelog-btn">Create</button>

<!-- Tables -->
<tr data-test="manager-row" [attr.data-manager-id]="manager.id">
  <td data-test="manager-email-cell">
    <span data-test="manager-email">{{ manager.email }}</span>
  </td>
</tr>

<!-- Forms -->
<lfx-input dataTest="manager-email-input" />
<lfx-button dataTest="save-manager-btn" />
```

### Shared Component Testing

Custom components use the `dataTest` input binding:

```typescript
// Component usage
<lfx-button dataTest="cancel-btn" label="Cancel" />

// Test access
cy.dataTest('cancel-btn').click();
```

### Empty State Testing

Empty states are properly tested with dedicated fixtures:

```typescript
it('should show empty state when no managers exist', () => {
  cy.intercept('GET', '/api/managers', { statusCode: 200, body: [] });
  cy.visit('/dashboard/managers');

  cy.dataTest('managers-table').within(() => {
    cy.get('[data-test="empty-state"]').should('be.visible');
    cy.get('span').should('contain', 'No managers found');
  });
});
```

## Data-Test Attributes Reference

This section lists all the `data-test` attributes that have been added to the
v1-changelog application for Cypress testing.

### Usage in Cypress Tests

#### Accessing Elements

```typescript
// Static selectors
cy.dataTest('login-btn').click();
cy.dataTest('entry-title-input').type('Test Entry');

// Dynamic selectors
cy.dataTest('nav-changelog').click();
cy.dataTest('entry-type-feature').should('be.visible');
```

#### Custom Command

The `dataTest()` command is available:

```typescript
Cypress.Commands.add('dataTest', (value: string) => {
  return cy.get(`[data-test="${value}"]`);
});
```

### Maintenance

When adding new UI components:

1. Add appropriate `data-test` attributes
2. Follow the naming conventions above
3. Update this reference document
4. Add corresponding test selectors to Cypress tests

When modifying existing components:

1. Preserve existing `data-test` attributes
2. Update attribute names if functionality changes
3. Update Cypress tests if selectors change

## API Testing

### Authentication API

- `/api/managers/check` - Manager permission validation
- Auth0 login/logout flows
- Session management endpoints

### CRUD Operations

- `/api/changelog/entries*` - Changelog CRUD
- `/api/products*` - Product management
- `/api/managers*` - Manager administration

### AI Integration

- `/api/ai/generate-release-notes*` - AI content generation
- Error handling for missing GitHub/JIRA integrations
- Loading state management

## Running Tests

### Prerequisites

1. **Start Services**:

   ```bash
   # Start database and backend
   yarn start

   # Or start frontend only (for API mocking)
   yarn start:frontend-only
   ```

2. **Environment Setup**:
   Create `cypress.env.json` with the following structure:

   ```json
   {
     "CHANGELOG_AUTH_USERNAME": "your-manager-username",
     "CHANGELOG_AUTH_PASSWORD": "your-manager-password",
     "CHANGELOG_PUBLIC_USERNAME": "your-public-username",
     "CHANGELOG_PUBLIC_PASSWORD": "your-public-password",
     "CHANGELOG_AUTH_NAME": "Your Test Manager Name",
     "CHANGELOG_MANAGER_EMAIL": "your-manager@example.com",
     "CHANGELOG_PROJECT_NAME": "Your Test Project Name",
     "CHANGELOG_BASE_URL": "http://localhost:4204"
   }
   ```

   **Environment Variables Explained**:
   - `CHANGELOG_AUTH_USERNAME/PASSWORD`: Manager user credentials for authenticated tests
   - `CHANGELOG_PUBLIC_USERNAME/PASSWORD`: Regular user credentials for access control tests
   - `CHANGELOG_AUTH_NAME`: Display name for the manager user
   - `CHANGELOG_MANAGER_EMAIL`: Email address for manager-specific tests
   - `CHANGELOG_PROJECT_NAME`: Project name used in test scenarios
   - `CHANGELOG_BASE_URL`: Base URL for the application - [default is localhost:4200](http://localhost:4200)

   **Security Note**: The `cypress.env.json` file contains test credentials and
   should never be committed to version control. It's included in `.gitignore`
   to prevent accidental commits. Use test-specific Auth0 users, not production
   accounts.

### Test Execution

```bash
# Interactive mode (recommended for development)
yarn cypress:open

# Headless mode (CI/CD)
yarn cypress:run

# Specific test suite
yarn cypress:run --spec "cypress/e2e/dashboard.cy.ts"

# Debug mode with headed browser
yarn cypress:run --headed --no-exit
```

### Custom Commands Philosophy

The v1-changelog Cypress test suite follows a **strict duplication principle**:
custom commands are ONLY created for patterns that appear 2+ times in the
codebase. Single-use patterns remain inline to avoid over-engineering and
maintain test clarity.

#### Core Reusable Commands (2+ uses)

```typescript
// Authentication & Session Management
cy.login(); // Manager login using CHANGELOG_AUTH_USERNAME/PASSWORD
cy.loginAsUser(); // Regular user login using CHANGELOG_PUBLIC_USERNAME/PASSWORD
cy.logout(); // Clean logout

// API Setup (Multi-use patterns)
cy.setupAIApiMocks(); // AI generation API mocking
cy.setupPublicApiMocks(); // Public homepage API mocking

// Utilities (High-frequency use)
cy.dataTest(selector); // Data-test selection
cy.ifElementExists(sel, callback); // Conditional interactions (9 uses)
cy.interceptXhr(); // Clean request logs
cy.cleanupTestData(); // Reset test data
```

#### Single-Use Patterns (Kept Inline)

The following patterns were intentionally kept inline to avoid
over-engineering:

- **Complex API Setup**: Dashboard-specific API intercepts are inline as
  they're only used once
- **Product Form Filling**: Product creation form is only used in one test
- **Empty State Validation**: Context-specific empty states vary by component
- **Loading State Checks**: Component-specific loading patterns differ
- **Dialog Submission**: Submit actions vary by dialog type

## Best Practices

### Test Design

1. **Independent Tests**: Each test should be self-contained
2. **Data Isolation**: Use fixtures and API mocking to avoid data dependencies
3. **Reliable Selectors**: Always use `data-test` attributes
4. **Session Management**: Use `cy.session()` for authentication
5. **Error Handling**: Test both success and failure scenarios

### Command Creation Guidelines

1. **Duplication Threshold**: Only create commands for patterns used 2+ times
2. **Avoid Over-Engineering**: Keep single-use logic inline for clarity
3. **Context Matters**: Similar-looking code with different contexts should
   remain separate
4. **Maintenance Balance**: Commands should reduce maintenance, not increase
   complexity
5. **Readability First**: Prefer explicit inline code over unnecessary
   abstraction

### Code Organization

1. **Descriptive Names**: Test names should clearly describe the behavior
2. **Proper Grouping**: Use `describe()` blocks to organize related tests
3. **Setup/Teardown**: Use `beforeEach()`/`afterEach()` for common setup
4. **Page Objects**: Extract complex interactions into reusable functions

### Performance

1. **Parallel Execution**: Configure Cypress for parallel test runs
2. **Smart Waiting**: Use proper waits and assertions
3. **Fixture Caching**: Reuse fixture data across tests
4. **API Mocking**: Mock external APIs to reduce test time

### Maintenance

1. **Regular Updates**: Keep test data and selectors current
2. **Documentation**: Update test documentation with new features
3. **Refactoring**: Regularly refactor tests for maintainability
4. **Coverage Monitoring**: Track test coverage and add missing tests

## Troubleshooting

### Common Issues

#### Authentication Problems

```text
Error: Login failed or timed out
```

**Solution**: Check Auth0 configuration and test credentials in
`cypress.env.json`. Verify both `CHANGELOG_AUTH_USERNAME/PASSWORD` (manager)
and `CHANGELOG_PUBLIC_USERNAME/PASSWORD` (regular user) are valid.

#### Element Not Found

```text
Error: Expected to find element with data-test="xyz"
```

**Solution**: Verify the component has the correct `data-test` attribute

#### API Intercept Issues

```text
Error: cy.wait() timed out waiting for alias "@getManagers"
```

**Solution**: Check API endpoint URLs and fixture data

#### Empty State Not Showing

```text
Error: Expected to find empty state elements
```

**Solution**: Ensure API intercept returns empty array and component handles
empty data

### Debug Strategies

1. **Interactive Mode**: Use `yarn cypress:open` for step-by-step debugging
2. **Screenshots**: Failed tests automatically capture screenshots
3. **Console Logs**: Check browser console for JavaScript errors
4. **Network Tab**: Verify API calls and responses
5. **Element Inspector**: Use browser DevTools to inspect elements

### Environment Issues

#### Database Connection

Ensure PostgreSQL and PostgREST services are running:

```bash
docker-compose up -d
```

#### Frontend Server

Start the Angular development server:

```bash
yarn start:frontend-only
```

#### Auth0 Configuration

Verify Auth0 tenant and application settings match test environment.

## Continuous Integration

### CI/CD Pipeline Integration

```yaml
# Example GitHub Actions workflow
- name: E2E Tests
  run: |
    yarn start:e2e &
    yarn cypress:run --record --key ${{ secrets.CYPRESS_RECORD_KEY }}
```

### Test Reporting

- Cypress Dashboard integration for test analytics
- Screenshot and video capture for failed tests
- Test result integration with GitHub status checks

### Environment Management

- Separate test environments for different branches
- Test data seeding and cleanup automation
- Environment-specific configuration management

---

## Summary

This testing framework provides comprehensive coverage of the v1-changelog
application with:

- **Reliable Authentication**: Auth0 integration with session management
- **Complete Coverage**: Public features, manager dashboard, and admin functions
- **Robust Data Management**: Fixtures and API mocking for consistent test data
- **Maintainable Selectors**: Data-test attributes for reliable element selection
- **Refined Command Strategy**: Custom commands only for genuinely duplicated patterns (2+ uses)
- **Balanced Abstraction**: Single-use patterns kept inline to maintain clarity
- **Best Practices**: Modern testing patterns with anti-over-engineering principles

The test suite ensures application reliability while maintaining code
readability and avoiding unnecessary complexity. The strict duplication
principle for custom commands ensures that abstractions provide genuine value
rather than premature optimization.

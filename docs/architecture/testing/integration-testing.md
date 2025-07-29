# Integration Testing

## 🔗 Integration Testing Strategy

Integration tests verify that different parts of the application work correctly together, focusing on API endpoints, service interactions, and data flow.

## 🏗 Backend Integration Testing

### Express Server Testing

```typescript
// Example: server.integration.spec.ts
import request from 'supertest';
import { app } from '../src/server/server';

describe('Server Integration', () => {
  let server: any;

  beforeAll(() => {
    server = app();
  });

  describe('Health Endpoint', () => {
    it('should return OK', async () => {
      const response = await request(server).get('/health').expect(200);

      expect(response.text).toBe('OK');
    });

    it('should not log health checks', async () => {
      // Verify health endpoint is excluded from logging
      const logSpy = jest.spyOn(console, 'log');

      await request(server).get('/health');

      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('/health'));
    });
  });

  describe('Authentication', () => {
    it('should redirect unauthenticated requests to Auth0', async () => {
      const response = await request(server).get('/dashboard').expect(302);

      expect(response.headers.location).toContain('auth0.com');
    });

    it('should serve protected content for authenticated users', async () => {
      // Mock authentication middleware
      const mockAuth = jest.fn((req, res, next) => {
        req.oidc = {
          isAuthenticated: () => true,
          user: {
            sub: 'test-user-123',
            name: 'Test User',
            email: 'test@example.com',
          },
        };
        next();
      });

      // This would require mocking the auth middleware
      // Implementation depends on testing setup
    });
  });
});
```

### API Route Testing

```typescript
// Example: api.integration.spec.ts
import request from 'supertest';
import { app } from '../src/server/server';

describe('API Integration', () => {
  let server: any;

  beforeAll(() => {
    server = app();
  });

  describe('Project API', () => {
    it('should return projects list', async () => {
      // This assumes API endpoints are implemented
      const response = await request(server).get('/api/projects').set('Authorization', 'Bearer valid-token').expect(200);

      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
            description: expect.any(String),
          }),
        ])
      );
    });

    it('should handle authentication errors', async () => {
      await request(server).get('/api/projects').expect(401);
    });

    it('should validate request parameters', async () => {
      await request(server).post('/api/projects').send({ invalidData: true }).set('Authorization', 'Bearer valid-token').expect(400);
    });
  });
});
```

## 🎯 Frontend Integration Testing

### Component-Service Integration

```typescript
// Example: project-list.integration.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture } from '@angular/core/testing';
import { ProjectListComponent } from './project-list.component';
import { ProjectService } from '../services/project.service';

describe('ProjectListComponent Integration', () => {
  let component: ProjectListComponent;
  let fixture: ComponentFixture<ProjectListComponent>;
  let httpMock: HttpTestingController;
  let projectService: ProjectService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectListComponent, HttpClientTestingModule],
      providers: [ProjectService],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectListComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    projectService = TestBed.inject(ProjectService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should load and display projects', async () => {
    const mockProjects = [
      { id: '1', name: 'Kubernetes', description: 'Container orchestration' },
      { id: '2', name: 'Prometheus', description: 'Monitoring system' },
    ];

    // Trigger component initialization
    fixture.detectChanges();

    // Expect HTTP request
    const req = httpMock.expectOne('/api/projects');
    expect(req.request.method).toBe('GET');
    req.flush(mockProjects);

    // Wait for async operations
    fixture.detectChanges();
    await fixture.whenStable();

    // Verify UI updates
    const projectCards = fixture.nativeElement.querySelectorAll('lfx-project-card');
    expect(projectCards.length).toBe(2);
    expect(projectCards[0].textContent).toContain('Kubernetes');
    expect(projectCards[1].textContent).toContain('Prometheus');
  });

  it('should handle loading states', () => {
    fixture.detectChanges();

    // Should show loading state
    expect(component.loading()).toBe(true);
    const loadingElement = fixture.nativeElement.querySelector('.loading');
    expect(loadingElement).toBeTruthy();

    // Complete the request
    const req = httpMock.expectOne('/api/projects');
    req.flush([]);

    fixture.detectChanges();

    // Should hide loading state
    expect(component.loading()).toBe(false);
    const loadingElementAfter = fixture.nativeElement.querySelector('.loading');
    expect(loadingElementAfter).toBeFalsy();
  });

  it('should handle errors gracefully', () => {
    fixture.detectChanges();

    const req = httpMock.expectOne('/api/projects');
    req.error(new ErrorEvent('Network error'), { status: 500 });

    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    const errorElement = fixture.nativeElement.querySelector('.error');
    expect(errorElement).toBeTruthy();
    expect(errorElement.textContent).toContain('error');
  });
});
```

### Router Integration Testing

```typescript
// Example: routing.integration.spec.ts
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { routes } from '../app.routes';

@Component({ template: '' })
class TestComponent {}

describe('Routing Integration', () => {
  let router: Router;
  let location: Location;
  let fixture: any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule.withRoutes([
          { path: '', component: TestComponent },
          { path: 'project/:id', component: TestComponent },
          { path: 'project/:id/meetings', component: TestComponent },
        ]),
      ],
      declarations: [TestComponent],
    }).compileComponents();

    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
    fixture = TestBed.createComponent(TestComponent);
  });

  it('should navigate to home', async () => {
    await router.navigate(['']);
    expect(location.path()).toBe('');
  });

  it('should navigate to project page', async () => {
    await router.navigate(['/project', 'kubernetes']);
    expect(location.path()).toBe('/project/kubernetes');
  });

  it('should navigate to project meetings', async () => {
    await router.navigate(['/project', 'kubernetes', 'meetings']);
    expect(location.path()).toBe('/project/kubernetes/meetings');
  });
});
```

## 🔄 SSR Integration Testing

### Server-Side Rendering Tests

```typescript
// Example: ssr.integration.spec.ts
import request from 'supertest';
import { app } from '../src/server/server';

describe('SSR Integration', () => {
  let server: any;

  beforeAll(() => {
    server = app();
  });

  it('should serve server-rendered HTML', async () => {
    const response = await request(server).get('/').expect(200).expect('Content-Type', /html/);

    // Verify SSR content
    expect(response.text).toContain('<!DOCTYPE html>');
    expect(response.text).toContain('<app-root');
    expect(response.text).toContain('LFX Projects Self-Service');
  });

  it('should inject auth context into SSR', async () => {
    // Mock authenticated request
    const response = await request(server).get('/dashboard').set('Cookie', 'mock-auth-cookie=value').expect(200);

    // Verify auth context is injected
    expect(response.text).toContain('authenticated: true');
  });

  it('should handle SSR errors gracefully', async () => {
    // Request non-existent route
    const response = await request(server).get('/non-existent-route').expect(404);

    expect(response.text).toContain('Not Found');
  });
});
```

## 📊 Database Integration Testing

### Mock Database Testing

```typescript
// Example: database.integration.spec.ts
import { TestContainer, StartedTestContainer } from 'testcontainers';

describe('Database Integration', () => {
  let container: StartedTestContainer;
  let databaseUrl: string;

  beforeAll(async () => {
    // Start test database container
    container = await new TestContainer('postgres:15').withEnvironment({ POSTGRES_PASSWORD: 'test' }).withExposedPorts(5432).start();

    const port = container.getMappedPort(5432);
    databaseUrl = `postgresql://postgres:test@localhost:${port}/postgres`;
  });

  afterAll(async () => {
    await container.stop();
  });

  it('should connect to database', async () => {
    // This would test actual database operations
    // Currently not implemented as we use direct API calls
    expect(databaseUrl).toBeDefined();
  });
});
```

## 🎯 Authentication Integration Testing

### Auth0 Integration

```typescript
// Example: auth.integration.spec.ts
import request from 'supertest';
import { app } from '../src/server/server';

describe('Authentication Integration', () => {
  let server: any;

  beforeAll(() => {
    server = app();
  });

  it('should redirect to Auth0 for login', async () => {
    const response = await request(server).get('/login').expect(302);

    expect(response.headers.location).toMatch(/auth0\.com/);
  });

  it('should handle Auth0 callback', async () => {
    // Mock Auth0 callback with authorization code
    const response = await request(server)
      .get('/callback')
      .query({
        code: 'mock-auth-code',
        state: 'mock-state',
      })
      .expect(302);

    // Should redirect to application
    expect(response.headers.location).not.toMatch(/auth0\.com/);
  });

  it('should maintain session after authentication', async () => {
    // This would require session management testing
    // Implementation depends on session storage
  });
});
```

## 🔧 Testing Utilities

### Integration Test Helpers

```typescript
// testing/integration-helpers.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

export function setupIntegrationTest(
  options: {
    imports?: any[];
    providers?: any[];
    declarations?: any[];
  } = {}
) {
  return TestBed.configureTestingModule({
    imports: [HttpClientTestingModule, RouterTestingModule, NoopAnimationsModule, ...(options.imports || [])],
    providers: options.providers || [],
    declarations: options.declarations || [],
  });
}

export function createMockUser() {
  return {
    sub: 'test-user-123',
    name: 'Test User',
    email: 'test@example.com',
    given_name: 'Test',
    family_name: 'User',
    nickname: 'testuser',
    picture: 'https://example.com/avatar.jpg',
    updated_at: '2023-01-01T00:00:00.000Z',
    email_verified: true,
    sid: 'test-session-123',
    'https://sso.linuxfoundation.org/claims/username': 'testuser',
  };
}

export function mockAuthContext(authenticated: boolean = true) {
  return {
    authenticated,
    user: authenticated ? createMockUser() : null,
  };
}
```

### API Mock Utilities

```typescript
// testing/api-mocks.ts
import { HttpInterceptor, HttpRequest, HttpHandler } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { of } from 'rxjs';

@Injectable()
export class MockApiInterceptor implements HttpInterceptor {
  private mocks = new Map<string, any>();

  intercept(req: HttpRequest<any>, next: HttpHandler) {
    const mockResponse = this.mocks.get(req.url);

    if (mockResponse) {
      return of(mockResponse);
    }

    return next.handle(req);
  }

  mockEndpoint(url: string, response: any) {
    this.mocks.set(url, response);
  }

  clearMocks() {
    this.mocks.clear();
  }
}

// Usage in tests
beforeEach(() => {
  const mockInterceptor = TestBed.inject(MockApiInterceptor);
  mockInterceptor.mockEndpoint('/api/projects', [{ id: '1', name: 'Test Project' }]);
});
```

## 🎯 Integration Testing Best Practices

### Testing Guidelines

1. **Test Real Interactions**: Use actual HTTP calls and routing
2. **Mock External Services**: Mock Auth0, databases, external APIs
3. **Test Error Scenarios**: Network failures, authentication errors
4. **Verify Data Flow**: From API through services to components
5. **Test State Management**: Signal updates across component boundaries

### Performance Considerations

1. **Parallel Test Execution**: Run tests concurrently when possible
2. **Test Data Isolation**: Ensure tests don't interfere with each other
3. **Resource Cleanup**: Properly clean up test resources
4. **Container Management**: Efficiently manage test containers

### CI/CD Integration

```yaml
# Example: .github/workflows/integration-tests.yml
name: Integration Tests

on: [push, pull_request]

jobs:
  integration:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: yarn install

      - name: Build shared packages
        run: yarn build

      - name: Run integration tests
        run: yarn test:integration
        env:
          CI: true
```

## 🔄 Implementation Status

### ✅ Ready for Implementation

- Express server testing patterns
- Component-service integration
- SSR testing strategies
- Authentication flow testing

### 🔲 Future Enhancements

- Database integration tests
- External API integration
- Performance integration tests
- Cross-browser integration testing
- Load testing integration

This integration testing strategy ensures that all parts of the application work correctly together and provides confidence in the overall system behavior.

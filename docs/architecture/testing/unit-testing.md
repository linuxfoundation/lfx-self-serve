# Unit Testing

## 🧪 Current Testing Status

Currently, the application has testing disabled in the Angular CLI configuration to focus on initial development. Test scaffolding is skipped for new components and services.

### Angular CLI Configuration

```json
// apps/lfx-pcc/angular.json
"schematics": {
  "@schematics/angular:component": {
    "skipTests": true
  },
  "@schematics/angular:service": {
    "skipTests": true
  },
  "@schematics/angular:guard": {
    "skipTests": true
  }
}
```

## 🚀 Future Testing Strategy

When testing is implemented, the application will use Angular's recommended testing tools and patterns.

## 🔧 Planned Testing Tools

### Frontend Testing Stack

- **Jest**: Primary testing framework for Angular applications
- **Angular Testing Utilities**: TestBed, ComponentFixture, async testing
- **Testing Library**: User-centric testing approaches
- **MSW (Mock Service Worker)**: API mocking for integration tests

### Test Types

- **Component Tests**: UI logic and user interactions
- **Service Tests**: Business logic and data handling
- **Pipe Tests**: Data transformation logic
- **Guard Tests**: Route protection logic

## 📋 Component Testing Patterns

### Signal-Based Component Testing

```typescript
// Example: project-card.component.spec.ts
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { ProjectCardComponent } from "./project-card.component";

describe("ProjectCardComponent", () => {
  let component: ProjectCardComponent;
  let fixture: ComponentFixture<ProjectCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectCardComponent);
    component = fixture.componentInstance;
  });

  it("should display project title", () => {
    // Set input signals
    fixture.componentRef.setInput("title", "Test Project");
    fixture.componentRef.setInput("description", "Test Description");

    fixture.detectChanges();

    const titleElement = fixture.nativeElement.querySelector("h3");
    expect(titleElement.textContent).toBe("Test Project");
  });

  it("should emit click events", () => {
    spyOn(component.onClick, "emit");

    const cardElement = fixture.nativeElement.querySelector(".project-card");
    cardElement.click();

    expect(component.onClick.emit).toHaveBeenCalled();
  });
});
```

### Testing PrimeNG Wrapper Components

```typescript
// Example: avatar.component.spec.ts
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { AvatarComponent } from "./avatar.component";
import { AvatarModule } from "primeng/avatar";

describe("AvatarComponent", () => {
  let component: AvatarComponent;
  let fixture: ComponentFixture<AvatarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AvatarComponent, AvatarModule],
    }).compileComponents();

    fixture = TestBed.createComponent(AvatarComponent);
    component = fixture.componentInstance;
  });

  it("should display image when provided", () => {
    fixture.componentRef.setInput("image", "test-image.jpg");
    fixture.detectChanges();

    expect(component.displayImage()).toBe("test-image.jpg");
    expect(component.displayIcon()).toBe("");
    expect(component.displayLabel()).toBe("");
  });

  it("should fallback to icon when image fails", () => {
    fixture.componentRef.setInput("image", "broken-image.jpg");
    fixture.componentRef.setInput("icon", "fa-user");

    // Simulate image error
    component.handleImageError();
    fixture.detectChanges();

    expect(component.displayImage()).toBe("");
    expect(component.displayIcon()).toBe("fa-user");
  });

  it("should fallback to label when no image or icon", () => {
    fixture.componentRef.setInput("label", "John Doe");
    fixture.detectChanges();

    expect(component.displayImage()).toBe("");
    expect(component.displayIcon()).toBe("");
    expect(component.displayLabel()).toBe("J");
  });
});
```

## 🎯 Service Testing Patterns

### Signal-Based Service Testing

```typescript
// Example: user.service.spec.ts
import { TestBed } from "@angular/core/testing";
import { UserService } from "./user.service";

describe("UserService", () => {
  let service: UserService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UserService);
  });

  it("should initialize with unauthenticated state", () => {
    expect(service.authenticated()).toBe(false);
    expect(service.user()).toBeNull();
  });

  it("should update authentication state", () => {
    const mockUser = {
      sub: "123",
      name: "John Doe",
      email: "john@example.com",
      // ... other user properties
    };

    service.authenticated.set(true);
    service.user.set(mockUser);

    expect(service.authenticated()).toBe(true);
    expect(service.user()).toEqual(mockUser);
  });
});
```

### HTTP Service Testing

```typescript
// Example: project.service.spec.ts
import { TestBed } from "@angular/core/testing";
import {
  HttpClientTestingModule,
  HttpTestingController,
} from "@angular/common/http/testing";
import { ProjectService } from "./project.service";

describe("ProjectService", () => {
  let service: ProjectService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ProjectService],
    });

    service = TestBed.inject(ProjectService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("should fetch projects", () => {
    const mockProjects = [
      { id: "1", name: "Project 1", description: "Description 1" },
      { id: "2", name: "Project 2", description: "Description 2" },
    ];

    service.loadProjects();

    const req = httpMock.expectOne("/api/projects");
    expect(req.request.method).toBe("GET");
    req.flush(mockProjects);

    expect(service.projects()).toEqual(mockProjects);
    expect(service.loading()).toBe(false);
  });

  it("should handle errors", () => {
    service.loadProjects();

    const req = httpMock.expectOne("/api/projects");
    req.error(new ErrorEvent("Network error"), { status: 500 });

    expect(service.error()).toBeTruthy();
    expect(service.loading()).toBe(false);
  });
});
```

## 🔧 Testing Configuration

### Jest Configuration

```typescript
// jest.config.ts
import type { Config } from "jest";

const config: Config = {
  preset: "jest-preset-angular",
  setupFilesAfterEnv: ["<rootDir>/setup-jest.ts"],
  globalSetup: "jest-preset-angular/global-setup",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  collectCoverageFrom: [
    "<rootDir>/src/**/*.ts",
    "!<rootDir>/src/**/*.spec.ts",
    "!<rootDir>/src/main.ts",
    "!<rootDir>/src/polyfills.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["html", "text-summary", "lcov"],
  transform: {
    "^.+\\.(ts|mjs|js|html)$": [
      "jest-preset-angular",
      {
        tsconfig: "tsconfig.spec.json",
        stringifyContentPathRegex: "\\.(html|svg)$",
      },
    ],
  },
};

export default config;
```

### Test Setup

```typescript
// setup-jest.ts
import "jest-preset-angular/setup-jest";
import "@testing-library/jest-dom";

// Mock global objects
Object.defineProperty(window, "CSS", { value: null });
Object.defineProperty(window, "getComputedStyle", {
  value: () => ({
    appearance: ["textfield"],
    getPropertyValue: () => "",
  }),
});

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
```

## 📊 Testing Utilities

### Custom Testing Utilities

```typescript
// testing/component-helpers.ts
import { ComponentFixture } from "@angular/core/testing";
import { DebugElement } from "@angular/core";
import { By } from "@angular/platform-browser";

export class ComponentHelper<T> {
  constructor(private fixture: ComponentFixture<T>) {}

  get component(): T {
    return this.fixture.componentInstance;
  }

  get element(): HTMLElement {
    return this.fixture.nativeElement;
  }

  detectChanges(): void {
    this.fixture.detectChanges();
  }

  querySelector(selector: string): HTMLElement | null {
    return this.element.querySelector(selector);
  }

  querySelectorAll(selector: string): NodeListOf<HTMLElement> {
    return this.element.querySelectorAll(selector);
  }

  getByTestId(testId: string): HTMLElement | null {
    return this.querySelector(`[data-testid="${testId}"]`);
  }

  clickElement(selector: string): void {
    const element = this.querySelector(selector);
    if (element) {
      element.click();
      this.detectChanges();
    }
  }

  setInputValue(selector: string, value: string): void {
    const input = this.querySelector(selector) as HTMLInputElement;
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event("input"));
      this.detectChanges();
    }
  }
}

// Usage in tests
export function createComponentHelper<T>(
  fixture: ComponentFixture<T>,
): ComponentHelper<T> {
  return new ComponentHelper(fixture);
}
```

## 🎯 Testing Best Practices

### Component Testing Guidelines

1. **Test User Interactions**: Focus on what users can see and do
2. **Avoid Implementation Details**: Test behavior, not internal structure
3. **Use Data Test IDs**: Reliable element selection
4. **Mock External Dependencies**: Isolate component logic
5. **Test Signal Updates**: Verify reactive behavior

### Service Testing Guidelines

1. **Test Public API**: Focus on public methods and properties
2. **Mock HTTP Calls**: Use HttpClientTestingModule
3. **Test Error Handling**: Verify error states and recovery
4. **Test Signal State**: Verify state management
5. **Isolate Dependencies**: Mock external services

### Signal Testing Patterns

```typescript
// Testing computed signals
it("should compute filtered data", () => {
  service.data.set([
    { id: 1, active: true },
    { id: 2, active: false },
    { id: 3, active: true },
  ]);

  expect(service.activeData()).toEqual([
    { id: 1, active: true },
    { id: 3, active: true },
  ]);
});

// Testing signal effects
it("should trigger effect on signal change", () => {
  const effectSpy = jasmine.createSpy("effect");

  effect(() => {
    service.data();
    effectSpy();
  });

  service.data.set([{ id: 1 }]);

  expect(effectSpy).toHaveBeenCalledTimes(2); // Initial + update
});
```

## 🔄 Implementation Plan

### Phase 1: Enable Testing

1. Remove `skipTests: true` from angular.json
2. Configure Jest for Angular
3. Set up testing utilities
4. Create test examples

### Phase 2: Core Component Tests

1. Test PrimeNG wrapper components
2. Test layout components
3. Test page components
4. Achieve 80%+ component coverage

### Phase 3: Service Tests

1. Test signal-based services
2. Test HTTP services
3. Test utility functions
4. Achieve 90%+ service coverage

### Phase 4: Integration Tests

1. Test component-service integration
2. Test routing and navigation
3. Test form workflows
4. End-to-end critical paths

This testing strategy will ensure high code quality and reliability once implemented in the development workflow.

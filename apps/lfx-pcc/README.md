# LFX PCC Application

This is the main Angular 19 application for the LFX PCC (Linux Foundation Experience Platform Community Contribution) project, built with experimental zoneless change detection and direct PrimeNG integration.

## Key Features

- **Angular 19** with experimental zoneless change detection
- **Angular Signals** for reactive state management
- **PrimeNG 19** UI components with custom LFX theming
- **Tailwind CSS v3** with PrimeUI plugin integration
- **LFX UI Core** design system
- **Server-Side Rendering (SSR)** for better performance
- **Standalone components** with explicit imports

## Development server

To start a local development server, run:

```bash
# From the root directory
yarn start

# Or from this directory
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Architecture

### Component Structure

- **Standalone Components**: All components use Angular's standalone architecture
- **LFX Prefix**: Components use the `lfx-` prefix (enforced by ESLint)
- **Direct PrimeNG Integration**: Components import PrimeNG modules directly

### State Management

- **Angular Signals**: Preferred for reactive state management
- **Zoneless Change Detection**: Experimental feature for improved performance
- **RxJS**: Used only when necessary for complex async operations

### Styling

- **CSS Layers**: Organized system (`tailwind-base, primeng, tailwind-utilities`)
- **Custom Fonts**: Open Sans (primary) and Roboto Slab (display)
- **LFX Theme**: Custom PrimeNG preset using LFX UI Core

## Using PrimeNG Components

### Basic Usage

```typescript
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'lfx-example',
  imports: [ButtonModule, CardModule],
  templateUrl: './example.component.html',
  styleUrl: './example.component.scss',
})
export class ExampleComponent {}
```

```html
<!-- example.component.html -->
<p-card header="Example Card" [shadow]="true">
  <p>Content goes here</p>
  <p-button label="Click me" severity="primary"></p-button>
</p-card>
```

### Available Components

The application has access to all PrimeNG components:

- **Button**: Full-featured button with variants, sizes, and icons
- **Card**: Flexible container with header, footer, and template support
- **And many more**: See [PrimeNG Documentation](https://primeng.org/)

### Template Support

PrimeNG components support custom templates:

```typescript
@Component({
  selector: 'lfx-custom-button',
  templateUrl: './custom-button.component.html',
  styleUrl: './custom-button.component.scss',
})
export class CustomButtonComponent {}
```

```html
<!-- custom-button.component.html -->
<p-button label="Custom Icon" severity="success">
  <ng-template pTemplate="icon">
    <i class="fas fa-rocket text-yellow-400"></i>
  </ng-template>
</p-button>
```

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
# Generate a standalone component (recommended)
ng generate component component-name --standalone

# Generate a service
ng generate service service-name

# Generate a guard
ng generate guard guard-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
# From the root directory
yarn build

# Or from this directory
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

### SSR Build

For server-side rendering builds:

```bash
# Build for SSR
ng build --configuration=production

# Serve SSR locally
yarn serve:ssr
```

## Testing

### Unit Tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
# From the root directory
yarn test

# Or from this directory
ng test
```

### End-to-End Tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Code Quality

### Linting

```bash
# From the root directory
yarn lint

# Or from this directory
ng lint
```

### Formatting

```bash
# From the root directory
yarn format

# Format check only
yarn format:check
```

## Configuration

### Path Mappings

The application uses TypeScript path mappings for cleaner imports:

```typescript
// Instead of relative imports
import { ColorConfig } from '../../../config/styles/colors';

// Use path mappings
import { ColorConfig } from '@config/styles/colors';
import { MyService } from '@app/services/my-service';
```

### Environment Configuration

- **Development**: `ng serve` with hot module replacement
- **Production**: Optimized builds with SSR support
- **Testing**: Angular testing environment with Karma

## Deployment

The application supports multiple deployment strategies:

1. **Node.js with PM2**: Production process management
2. **Docker**: Multi-stage builds for optimized containers
3. **AWS ECS**: Automated CI/CD pipeline

See the root `docs/deployment.md` for detailed deployment instructions.

## Development Guidelines

### Before Committing

Always run these commands:

```bash
yarn lint           # Fix linting issues
yarn format         # Format code consistently
yarn test           # Ensure all tests pass
yarn build          # Verify build succeeds
```

### Component Development

- Use standalone components with explicit imports
- Follow the `lfx-` prefix convention
- Prefer Angular Signals over RxJS for simple state
- Use PrimeNG components directly with LFX theming

### Styling Guidelines

- Use Tailwind CSS utility classes
- Follow the CSS layers architecture
- Leverage PrimeNG's template system for customization
- Use LFX UI Core design tokens

## Additional Resources

- **[Angular CLI Documentation](https://angular.dev/tools/cli)** - Command reference
- **[PrimeNG Components](https://primeng.org/)** - UI component library
- **[LFX UI Core](https://github.com/linuxfoundation/lfx-ui-core)** - Design system
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[Angular Signals](https://angular.io/guide/signals)** - Reactive programming

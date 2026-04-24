# Authentication

## 🔐 Auth0 Integration with Express OpenID Connect

The application uses Auth0 for user authentication via `express-openid-connect` middleware with selective route protection and session management. The system implements a dual authentication pattern: user authentication for protected routes and machine-to-machine (M2M) authentication for server-side API calls.

## 🔧 Auth0 Configuration

### Environment Variables

```bash
# User Authentication (Auth0/Authelia)
PCC_AUTH0_SECRET='your-auth0-secret'
PCC_BASE_URL='http://localhost:4000'
PCC_AUTH0_ISSUER_BASE_URL='https://your-domain.auth0.com/'
PCC_AUTH0_CLIENT_ID='your-client-id'
PCC_AUTH0_CLIENT_SECRET='your-client-secret'
PCC_AUTH0_AUDIENCE='https://your-api-audience'

# Machine-to-Machine (M2M) Token Authentication
M2M_AUTH_CLIENT_ID='your-m2m-client-id'
M2M_AUTH_CLIENT_SECRET='your-m2m-client-secret'
M2M_AUTH_ISSUER_BASE_URL='https://auth.k8s.orb.local/'
M2M_AUTH_AUDIENCE='http://lfx-api.k8s.orb.local/'
```

### Express Server Integration

The authentication configuration uses selective authentication (`authRequired: false`) with custom route protection middleware. This allows public routes to bypass authentication while maintaining protection for sensitive areas.

**Configuration Location**: `apps/lfx-one/src/server/server.ts`

## 📋 User Interface

### User Data Structure

```typescript
// packages/shared/src/interfaces/auth.interface.ts
export interface User {
  sid: string;
  'https://sso.linuxfoundation.org/claims/username': string;
  given_name: string;
  family_name: string;
  nickname: string;
  name: string;
  picture: string;
  updated_at: string;
  email: string;
  email_verified: boolean;
  sub: string;
}

export interface AuthContext {
  authenticated: boolean;
  user: User | null;
  // Persona + project enrichment (populated server-side via persona-detection, hydrated to the
  // browser through Angular TransferState — see apps/lfx-one/src/server/services/persona-detection.service.ts)
  persona?: PersonaType | null;
  personas?: PersonaType[];
  organizations?: Account[];
  projects?: EnrichedPersonaProject[];
  personaProjects?: Partial<Record<PersonaType, PersonaProject[]>>;
  // Impersonation capability + active state — see docs/architecture/backend/impersonation.md
  canImpersonate?: boolean;
  impersonating?: boolean;
  impersonator?: Impersonator;
}

/**
 * M2M Token Response Interface
 * Used for machine-to-machine authentication responses
 */
export interface M2MTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}
```

## 🏗 Server-Side Implementation

### Auth Context Injection

The server creates an authentication context for each request and injects it into Angular's SSR:

```typescript
// apps/lfx-one/src/server/server.ts
app.use('/**', (req: Request, res: Response, next: NextFunction) => {
  const auth: AuthContext = {
    authenticated: false,
    user: null,
  };

  if (req.oidc?.isAuthenticated()) {
    auth.authenticated = true;
    auth.user = req.oidc?.user as User;
  }

  angularApp
    .handle(req, {
      auth,
      providers: [
        { provide: APP_BASE_HREF, useValue: process.env['PCC_BASE_URL'] },
        { provide: REQUEST, useValue: req },
        { provide: 'RESPONSE', useValue: res },
      ],
    })
    .then((response) => {
      if (response) {
        return writeResponseToNodeResponse(response, res);
      }
      return next();
    })
    .catch((error) => {
      req.log.error({ error }, 'Error rendering Angular application');
      if (error.code === 'NOT_FOUND') {
        res.status(404).send('Not Found');
      } else if (error.code === 'UNAUTHORIZED') {
        res.status(401).send('Unauthorized');
      } else {
        res.status(500).send('Internal Server Error');
      }
    });
});
```

## 🎯 Frontend User Service

### Simple Signal-Based State

```typescript
// apps/lfx-one/src/app/shared/services/user.service.ts
import { Injectable, signal, WritableSignal } from '@angular/core';
import { User } from '@lfx-one/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  public authenticated: WritableSignal<boolean> = signal<boolean>(false);
  public user: WritableSignal<User | null> = signal<User | null>(null);
}
```

## 🔒 Authentication Architecture

### Selective Authentication Pattern

The application implements a sophisticated authentication system with multiple layers:

1. **Public Routes**: Routes like `/meeting` and `/public/api` bypass authentication entirely
2. **Protected Routes**: All other routes require user authentication
3. **Custom Login Flow**: Enhanced login handling with URL validation and secure redirects
4. **M2M Authentication**: Server-side API calls use machine-to-machine tokens
5. **Session Management**: Express OpenID Connect handles user sessions automatically
6. **Auth Context Injection**: Server provides authentication state to Angular SSR
7. **Client State Management**: Frontend maintains authentication state using Angular signals

### Auth Middleware

The unified auth middleware (`apps/lfx-one/src/server/middleware/auth.middleware.ts`) implements selective authentication logic using a `DEFAULT_ROUTE_CONFIG` array for fine-grained route-based authentication decisions:

- **Route Analysis**: Examines incoming requests against route config to determine authentication requirements
- **Public Route Bypass**: Allows specific routes (e.g., `/meetings/`, `/public/api`) to use optional authentication
- **Conditional Redirects**: GET requests redirect to login, API requests return 401
- **Token Refresh**: Automatically handles expired tokens
- **Error Handling**: Provides structured authentication errors

### Custom Login Handler

The system includes a custom login route (`/login`) that provides:

- **URL Validation**: Ensures secure redirect destinations
- **State Management**: Handles authentication state transitions
- **Return-to Functionality**: Redirects users to their intended destination after login

## 🤖 Machine-to-Machine (M2M) Authentication

### Architecture Overview

The M2M system enables server-side components to authenticate with external APIs:

- **Token Generation**: Automatic M2M token creation for server-side requests
- **Provider Support**: Compatible with both Auth0 and Authelia
- **Error Handling**: Comprehensive error management for token failures
- **Logging**: Structured logging for token operations

**Implementation**: `apps/lfx-one/src/server/utils/m2m-token.util.ts`

### Public Endpoint Integration

Public endpoints use M2M tokens for backend API calls:

- **Token Injection**: M2M tokens are automatically generated and injected into requests
- **API Authentication**: Backend services receive authenticated requests
- **Transparent Operation**: Public endpoints remain unauthenticated for users while maintaining security for API calls

**Example**: Public Meeting Controller (`apps/lfx-one/src/server/controllers/public-meeting.controller.ts`)

### Authentication Flow Diagram

```text
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User Request  │───▶│  Route Analysis  │───▶│  Auth Decision  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │  Public Routes   │    │ Protected Routes│
                       │  (/meeting,      │    │ (all others)    │
                       │   /public/api)   │    │                 │
                       └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   Bypass Auth    │    │  Check Auth     │
                       │   Continue to    │    │  Status         │
                       │   Handler        │    │                 │
                       └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │  Authenticated? │
                                                └─────────────────┘
                                                    │         │
                                                   Yes       No
                                                    │         │
                                                    ▼         ▼
                                           ┌─────────────┐ ┌──────────┐
                                           │   Continue  │ │ Redirect │
                                           │   to Route  │ │ to Login │
                                           └─────────────┘ └──────────┘
```

### Logout Process

```text
1. User accesses /logout (provided by express-openid-connect)
2. Middleware clears session and redirects to Auth0 logout
3. Auth0 clears authentication and redirects back to application
```

## 🛡 Security Features

### Built-in Security

- **CSRF Protection**: Handled by express-openid-connect
- **Session Security**: Secure session management
- **Token Validation**: Automatic JWT validation
- **Secure Redirects**: Safe redirect handling

### Configuration Security

- **Environment Variables**: All sensitive config in environment variables
- **Fallback Values**: Safe fallback values for development
- **Signing Algorithm**: HS256 token signing specified
- **Scope Configuration**: Minimal required scopes defined

## 🔄 Error Handling

### Server Error Handling

```typescript
// Error handling in the main request handler
.catch((error) => {
  req.log.error({ error }, 'Error rendering Angular application');
  if (error.code === 'NOT_FOUND') {
    res.status(404).send('Not Found');
  } else if (error.code === 'UNAUTHORIZED') {
    res.status(401).send('Unauthorized');
  } else {
    res.status(500).send('Internal Server Error');
  }
});
```

## 📊 What's Implemented

- Dual authentication: user auth (Auth0/Authelia) + M2M tokens for server-side API calls
- Selective route protection with public route bypass (`/meeting`, `/public/api`)
- Custom login flow with URL validation and secure redirects
- Server-side auth context injection into Angular SSR
- Bearer token middleware for API routes
- Public meeting access with optional passcode

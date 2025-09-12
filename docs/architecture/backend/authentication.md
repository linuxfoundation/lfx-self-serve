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

**Configuration Location**: `apps/lfx-pcc/src/server/server.ts`

## 📋 User Interface

### User Data Structure

```typescript
// packages/shared/src/interfaces/auth.ts
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
// apps/lfx-pcc/src/server/server.ts
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
// apps/lfx-pcc/src/app/shared/services/user.service.ts
import { Injectable, signal, WritableSignal } from '@angular/core';
import { User } from '@lfx-pcc/shared/interfaces';

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

### Protected Routes Middleware

A custom middleware (`apps/lfx-pcc/src/server/middleware/protected-routes.middleware.ts`) implements the selective authentication logic:

- **Route Analysis**: Examines incoming requests to determine authentication requirements
- **Public Route Bypass**: Allows specific routes to skip authentication
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

**Implementation**: `apps/lfx-pcc/src/server/utils/m2m-token.util.ts`

### Public Endpoint Integration

Public endpoints use M2M tokens for backend API calls:

- **Token Injection**: M2M tokens are automatically generated and injected into requests
- **API Authentication**: Backend services receive authenticated requests
- **Transparent Operation**: Public endpoints remain unauthenticated for users while maintaining security for API calls

**Example**: Public Meeting Controller (`apps/lfx-pcc/src/server/controllers/public-meeting.controller.ts`)

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

## 📊 Current Implementation Status

### ✅ Implemented Features

- **Dual Authentication System**: User authentication + M2M token system
- **Selective Route Protection**: Public routes bypass authentication
- **Enhanced Auth0/Authelia Integration**: Support for multiple auth providers
- **Custom Login Flow**: Secure URL validation and redirect handling
- **M2M Token Management**: Automatic server-side authentication for API calls
- **Public Meeting Access**: Unauthenticated access to meeting pages with optional passcode
- **Bearer Token Middleware**: API route authentication handling
- **Comprehensive Error Handling**: Structured authentication error responses
- **Server-side Auth Context**: Enhanced user info injection into Angular SSR

### 🔲 Not Yet Implemented

- **Frontend Auth Initialization**: Client-side auth state sync with server context
- **Authentication UI Components**: Login/logout interface elements
- **User Profile Management**: Profile editing and management features
- **Client-side Navigation Guards**: Route-level authentication checks
- **User Interface Elements**: Authentication status indicators and user menus

This documentation describes the current comprehensive authentication architecture supporting both user authentication and machine-to-machine patterns with selective route protection.

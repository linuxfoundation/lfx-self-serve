# Authentication

## 🔐 Auth0 Integration with Express OpenID Connect

The application uses Auth0 for user authentication via `express-openid-connect` middleware with automatic route protection and session management.

## 🔧 Auth0 Configuration

### Environment Variables

```bash
# Required environment variables
PCC_AUTH0_SECRET='your-auth0-secret'
PCC_BASE_URL='http://localhost:4000'
PCC_AUTH0_ISSUER_BASE_URL='https://your-domain.auth0.com'
PCC_AUTH0_CLIENT_ID='your-client-id'
PCC_AUTH0_CLIENT_SECRET='your-client-secret'
PCC_AUTH0_AUDIENCE='https://your-api-audience'
```

### Express Server Integration

```typescript
// apps/lfx-pcc/src/server/server.ts
import { auth, ConfigParams } from "express-openid-connect";

const authConfig: ConfigParams = {
  authRequired: true,
  auth0Logout: true,
  baseURL: process.env["PCC_BASE_URL"] || "http://localhost:4000",
  clientID: process.env["PCC_AUTH0_CLIENT_ID"] || "1234",
  issuerBaseURL:
    process.env["PCC_AUTH0_ISSUER_BASE_URL"] || "https://example.com",
  secret: process.env["PCC_AUTH0_SECRET"] || "sufficiently-long-string",
  idTokenSigningAlg: "HS256",
  authorizationParams: {
    response_type: "code",
    audience: process.env["PCC_AUTH0_AUDIENCE"] || "https://example.com",
    scope: "openid email profile api offline_access",
  },
  clientSecret: process.env["PCC_AUTH0_CLIENT_SECRET"] || "bar",
};

app.use(auth(authConfig));
```

## 📋 User Interface

### User Data Structure

```typescript
// packages/shared/src/interfaces/auth.ts
export interface User {
  sid: string;
  "https://sso.linuxfoundation.org/claims/username": string;
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
```

## 🏗 Server-Side Implementation

### Auth Context Injection

The server creates an authentication context for each request and injects it into Angular's SSR:

```typescript
// apps/lfx-pcc/src/server/server.ts
app.use("/**", (req: Request, res: Response, next: NextFunction) => {
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
        { provide: APP_BASE_HREF, useValue: process.env["PCC_BASE_URL"] },
        { provide: REQUEST, useValue: req },
        { provide: "RESPONSE", useValue: res },
      ],
    })
    .then((response) => {
      if (response) {
        return writeResponseToNodeResponse(response, res);
      }
      return next();
    })
    .catch((error) => {
      req.log.error({ error }, "Error rendering Angular application");
      if (error.code === "NOT_FOUND") {
        res.status(404).send("Not Found");
      } else if (error.code === "UNAUTHORIZED") {
        res.status(401).send("Unauthorized");
      } else {
        res.status(500).send("Internal Server Error");
      }
    });
});
```

## 🎯 Frontend User Service

### Simple Signal-Based State

```typescript
// apps/lfx-pcc/src/app/shared/services/user.service.ts
import { Injectable, signal, WritableSignal } from "@angular/core";
import { User } from "@lfx-pcc/shared/interfaces";

@Injectable({
  providedIn: "root",
})
export class UserService {
  public authenticated: WritableSignal<boolean> = signal<boolean>(false);
  public user: WritableSignal<User | null> = signal<User | null>(null);
}
```

## 🔒 Authentication Flow

### How Authentication Works

1. **Route Protection**: All routes are protected by default (`authRequired: true`)
2. **Automatic Redirect**: Unauthenticated users are automatically redirected to Auth0
3. **Session Management**: Express OpenID Connect handles sessions automatically
4. **Auth Context**: Server injects auth context into Angular SSR for each request
5. **Client State**: Frontend UserService maintains authentication state signals

### Login Process

```text
1. User accesses any route
2. Express OpenID Connect middleware checks authentication
3. If not authenticated, automatically redirects to Auth0
4. User completes Auth0 authentication
5. Auth0 redirects back with authorization code
6. Express OpenID Connect exchanges code for tokens
7. User session is established
8. Auth context is available in req.oidc
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

- Express OpenID Connect integration
- Auth0 configuration with environment variables
- Server-side auth context injection
- Basic UserService with signals
- Automatic route protection
- Error handling for auth failures

### 🔲 Not Yet Implemented

- Frontend auth state initialization from server context
- Login/logout UI components
- User profile management
- API route protection middleware
- Client-side navigation guards
- User menu and authentication UI

This documentation reflects the current minimal but functional authentication implementation using express-openid-connect with Auth0.

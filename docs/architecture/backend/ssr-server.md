# SSR Server

## 🖥 Express.js with Angular 19 SSR

The application uses Express.js as the server framework with Angular 19's built-in server-side rendering capabilities.

### Main Server Configuration

```typescript
// src/server/server.ts
import { APP_BASE_HREF } from '@angular/common';
import { REQUEST } from '@angular/core';
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import { AuthContext, User } from '@lfx-pcc/shared/interfaces';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { auth, ConfigParams } from 'express-openid-connect';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pinoHttp from 'pino-http';

// Middleware and route imports
import { extractBearerToken } from './middleware/auth-token.middleware';
import { apiErrorHandler } from './middleware/error-handler.middleware';
import { tokenRefreshMiddleware } from './middleware/token-refresh.middleware';
import projectsRouter from './routes/projects';

dotenv.config();

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const angularApp = new AngularNodeAppEngine();
const app = express();

// Serve static files from /browser
app.get(
  '**',
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: 'index.html',
  })
);
```

## 🔧 Angular 19 SSR Integration

### Health Check Endpoint

```typescript
// Health endpoint before logger middleware
app.get('/health', (_req: Request, res: Response) => {
  res.send('OK');
});
```

### Logging Configuration

```typescript
const logger = pinoHttp({
  autoLogging: {
    ignore: (req: Request) => {
      return req.url === '/health' || req.url === '/api/health';
    },
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    remove: true,
  },
  level: 'info',
});

app.use(logger);
```

### Authentication with Auth0

```typescript
const authConfig: ConfigParams = {
  authRequired: true,
  auth0Logout: true,
  baseURL: process.env['PCC_BASE_URL'] || 'http://localhost:4000',
  clientID: process.env['PCC_AUTH0_CLIENT_ID'] || '1234',
  issuerBaseURL: process.env['PCC_AUTH0_ISSUER_BASE_URL'] || 'https://example.com',
  secret: process.env['PCC_AUTH0_SECRET'] || 'sufficiently-long-string',
  idTokenSigningAlg: 'HS256',
  authorizationParams: {
    response_type: 'code',
    audience: process.env['PCC_AUTH0_AUDIENCE'] || 'https://example.com',
    scope: 'openid email profile api offline_access',
  },
  clientSecret: process.env['PCC_AUTH0_CLIENT_SECRET'] || 'bar',
};

app.use(auth(authConfig));
app.use(tokenRefreshMiddleware);
```

## 🚀 API Routes and Middleware

### API Route Configuration

```typescript
// Apply bearer token middleware to all API routes
app.use('/api', extractBearerToken);

// Mount API routes before Angular SSR
app.use('/api/projects', projectsRouter);

// Add API error handler middleware
app.use('/api/*', apiErrorHandler);
```

### Angular SSR Request Handling

```typescript
// Handle all other requests by rendering the Angular application
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

## 🚀 Server Startup

### Server Configuration

```typescript
export function startServer() {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    logger.logger.info(`Node Express server listening on http://localhost:${port}`);
  });
}

const metaUrl = import.meta.url;
const isMain = isMainModule(metaUrl);
const isPM2 = process.env['PM2'] === 'true';

if (isMain || isPM2) {
  startServer();
}

// The request handler used by the Angular CLI (dev-server and during build)
export const reqHandler = createNodeRequestHandler(app);
```

### Environment Variables

- **PCC_BASE_URL**: Base URL for the application (default: <http://localhost:4000>)
- **PCC_AUTH0_CLIENT_ID**: Auth0 client ID
- **PCC_AUTH0_ISSUER_BASE_URL**: Auth0 issuer base URL
- **PCC_AUTH0_SECRET**: Auth0 secret for session encryption
- **PCC_AUTH0_AUDIENCE**: Auth0 API audience
- **PCC_AUTH0_CLIENT_SECRET**: Auth0 client secret
- **PORT**: Server port (default: 4000)
- **PM2**: Flag to indicate PM2 environment

## 🔒 Security and Authentication

### Auth0 Integration Features

- **Session Management**: Secure session handling with encrypted cookies
- **Token Refresh**: Automatic token refresh middleware for seamless authentication
- **API Authentication**: Bearer token extraction for API routes
- **User Context**: Authentication context passed to Angular SSR for server-side rendering

### Middleware Stack

1. **Static File Serving**: Serves pre-built Angular assets
2. **Health Check**: Unauthenticated endpoint for monitoring
3. **Logging**: Pino HTTP logger with request/response tracking
4. **Authentication**: Auth0 middleware for session management
5. **Token Refresh**: Keeps authentication tokens fresh
6. **API Routes**: Protected API endpoints with bearer token validation
7. **Angular SSR**: Server-side rendering with authentication context

## 🔄 Server-Side Rendering Features

### Authentication Context in SSR

The server passes authentication context to Angular during SSR:

```typescript
const auth: AuthContext = {
  authenticated: false,
  user: null,
};

if (req.oidc?.isAuthenticated()) {
  auth.authenticated = true;
  auth.user = req.oidc?.user as User;
}

// Pass auth context to Angular
angularApp.handle(req, {
  auth,
  providers: [
    { provide: APP_BASE_HREF, useValue: process.env['PCC_BASE_URL'] },
    { provide: REQUEST, useValue: req },
    { provide: 'RESPONSE', useValue: res },
  ],
});
```

### Error Handling

The server handles different error scenarios during SSR:

- **404 Not Found**: Returns appropriate 404 response
- **401 Unauthorized**: Returns unauthorized response
- **500 Internal Server Error**: Generic error response with logging

## 🔧 Key Features

### Production-Ready Features

1. **Health Monitoring**: Dedicated `/health` endpoint for load balancers and monitoring
2. **Structured Logging**: Pino logger with automatic request/response logging
3. **Security**: Auth0 integration with secure session management
4. **API Protection**: Bearer token validation for API routes
5. **Error Handling**: Comprehensive error handling for both API and SSR routes
6. **PM2 Support**: Built-in support for PM2 process management

### Development Features

1. **Angular CLI Integration**: Request handler for dev server and builds
2. **Environment Configuration**: Dotenv support for local development
3. **Hot Module Replacement**: Integrated with Angular's development server
4. **Detailed Error Logging**: Enhanced error messages during development

## 📁 Project Structure

```text
src/server/
├── server.ts                    # Main server configuration
├── middleware/
│   ├── auth-token.middleware.ts # Bearer token extraction
│   ├── error-handler.middleware.ts # API error handling
│   └── token-refresh.middleware.ts # Auth0 token refresh
└── routes/
    └── projects.ts              # Project API routes
```

This Express.js configuration provides a robust foundation for serving Angular 19 SSR applications with proper security, performance, and development features.

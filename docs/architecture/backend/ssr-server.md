# SSR Server

## 🖥 Express.js with Angular Universal

The application uses Express.js as the server framework with Angular Universal for server-side rendering.

### Server Configuration

```typescript
// src/server/server.ts
import express from "express";
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from "@angular/ssr/node";

const angularApp = new AngularNodeAppEngine();

export function app(): express.Express {
  const server = express();
  const distFolder = join(process.cwd(), "dist/lfx-pcc");
  const indexHtml = existsSync(join(distFolder, "index.original.html"))
    ? join(distFolder, "index.original.html")
    : join(distFolder, "index.html");

  // Serve static files with proper caching
  server.get(
    "/favicon.ico",
    express.static(join(distFolder, "favicon.ico"), { maxAge: "1y" }),
  );
  server.get(
    "**",
    express.static(distFolder, { maxAge: "1y", index: "index.html" }),
  );

  // Handle all routes with Angular Universal
  server.get("**", (req, res, next) => {
    angularApp
      .handle(req)
      .then((response) => {
        if (response) {
          writeResponseToNodeResponse(response, res);
        } else {
          next();
        }
      })
      .catch(next);
  });

  return server;
}
```

## 🔧 Angular Universal Integration

### Server App Configuration

```typescript
// src/app/app.config.server.ts
export const config = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering(), provideServerRouting(serverRoutes)],
});
```

### Server Routes

```typescript
// src/app/app.routes.server.ts
export const serverRoutes: ServerRoute[] = [
  {
    path: "**",
    renderMode: RenderMode.Server,
  },
];
```

## 🚀 Development vs Production

### Development Server

```typescript
// Development mode with HMR
const server = app();
const port = process.env["PORT"] || 4000;

server.listen(port, () => {
  console.log(`Express server listening on http://localhost:${port}`);
});
```

### Production Server

```typescript
// Production with PM2 process management
if (isMainModule(import.meta.url)) {
  const server = app();
  const port = process.env["PORT"] || 4000;

  server.listen(port, () => {
    console.log(`Express server listening on http://localhost:${port}`);
  });
}
```

## 📦 Static File Serving

### Asset Optimization

```typescript
// Serve static files with proper caching headers
server.get(
  "/favicon.ico",
  express.static(join(distFolder, "favicon.ico"), {
    maxAge: "1y",
    immutable: true,
  }),
);

server.get(
  "**",
  express.static(distFolder, {
    maxAge: "1y",
    index: "index.html",
    setHeaders: (res, path) => {
      // Cache busting for JS/CSS files
      if (path.endsWith(".js") || path.endsWith(".css")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);
```

### Content Types

- **HTML**: Server-side rendered with dynamic content
- **JavaScript**: Chunked bundles with aggressive caching
- **CSS**: Extracted styles with cache headers
- **Images**: Served with appropriate MIME types
- **Fonts**: Cached with long expiration

## 🔒 Security Headers

### HTTP Security

```typescript
// Security middleware
server.use((req, res, next) => {
  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // CSP header for production
  if (process.env["NODE_ENV"] === "production") {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' kit.fontawesome.com; style-src 'self' 'unsafe-inline' fonts.googleapis.com",
    );
  }

  next();
});
```

## 🎯 Request Handling

### Error Handling

```typescript
// Global error handler
server.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error("Server error:", err);

    if (res.headersSent) {
      return next(err);
    }

    res.status(500).json({
      error: "Internal Server Error",
      message:
        process.env["NODE_ENV"] === "development"
          ? err.message
          : "Something went wrong",
    });
  },
);
```

### Request Logging

```typescript
// Request logging middleware
server.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });

  next();
});
```

## 📊 Performance Optimization

### Response Compression

```typescript
import compression from "compression";

// Enable gzip compression
server.use(
  compression({
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return compression.filter(req, res);
    },
    level: 6,
    threshold: 1024,
  }),
);
```

### Keep-Alive Connections

```typescript
// Configure server for keep-alive
const httpServer = createServer(server);
httpServer.keepAliveTimeout = 30000;
httpServer.headersTimeout = 35000;
```

## 🔄 Server-Side Data Fetching

### Initial Data Loading

```typescript
// Services can provide initial data for SSR
@Injectable({ providedIn: "root" })
export class ServerDataService {
  private readonly http = inject(HttpClient);

  // This will run on the server during SSR
  public loadInitialData(): Promise<InitialData> {
    return firstValueFrom(this.http.get<InitialData>("/api/initial-data"));
  }
}
```

### Transfer State

```typescript
// Transfer server data to client
import { TransferState, makeStateKey } from '@angular/platform-browser';

const INITIAL_DATA_KEY = makeStateKey<InitialData>('initialData');

// On server: set data
constructor(private transferState: TransferState) {
  this.transferState.set(INITIAL_DATA_KEY, initialData);
}

// On client: get data
const initialData = this.transferState.get(INITIAL_DATA_KEY, null);
```

## 🔧 Development Features

### Hot Module Replacement

Development server supports Angular's HMR for faster development:

```typescript
// Development-specific features
if (process.env["NODE_ENV"] === "development") {
  // Enable source maps
  server.use("/dev", express.static("src"));

  // Development error handling
  server.use((err, req, res, next) => {
    res.status(500).send(`
      <h1>Development Error</h1>
      <pre>${err.stack}</pre>
    `);
  });
}
```

### Live Reload Integration

The development server integrates with Angular CLI's live reload system for seamless development experience.

## 📈 Monitoring

### Health Check Endpoint

```typescript
// Health check for load balancers
server.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env["npm_package_version"] || "1.0.0",
  });
});
```

### Metrics Collection

```typescript
// Basic metrics collection
let requestCount = 0;
let errorCount = 0;

server.use((req, res, next) => {
  requestCount++;

  res.on("finish", () => {
    if (res.statusCode >= 400) {
      errorCount++;
    }
  });

  next();
});

server.get("/metrics", (req, res) => {
  res.json({
    requests: requestCount,
    errors: errorCount,
    errorRate: errorCount / requestCount,
  });
});
```

This Express.js configuration provides a robust foundation for serving Angular Universal applications with proper security, performance, and development features.

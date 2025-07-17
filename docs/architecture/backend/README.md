# Backend Architecture

## 🖥 Overview

The LFX PCC backend consists of an Express.js server handling SSR, authentication, and API services with integrated logging and monitoring.

## 🏗 Architecture Components

### Server Stack

- **Express.js** server with Angular Universal SSR
- **Auth0** authentication integration
- **Winston** logging with structured logs
- **PM2** process management for production

### Services

- **Authentication Service** with Auth0 integration
- **User Service** for user profile management
- **Logging Service** with Winston and custom transports
- **Health Check** endpoints for monitoring

## 📋 Documentation Sections

### [SSR Server](./ssr-server.md)

Learn about Express.js configuration, Angular Universal integration, and server-side rendering setup.

### [Authentication](./authentication.md)

Understand Auth0 integration, JWT handling, and user session management.

### [Logging & Monitoring](./logging-monitoring.md)

Explore Winston logging configuration, structured logging, and monitoring strategies.

### [Deployment](./deployment.md)

Discover PM2 configuration, production deployment, and server management.

## 🚀 Key Features

- **Server-Side Rendering**: Angular Universal with Express.js
- **Authentication**: Auth0 integration with secure token handling
- **Structured Logging**: Winston with custom formatters and transports
- **Process Management**: PM2 for production deployment
- **Health Monitoring**: Built-in health check endpoints

## 🔗 Quick Links

- [Server Configuration](../../CLAUDE.md#backend-stack)
- [Development Commands](../../CLAUDE.md#development)
- [Production Deployment](../../CLAUDE.md#production)

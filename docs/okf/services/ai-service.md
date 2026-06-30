---
type: Service
title: AI Service
description: Provides AI-backed content generation using Claude Sonnet 4 through a LiteLLM proxy for meeting agendas and newsletter content.
resource: apps/lfx-one/src/server/services/ai.service.ts
tags: [backend, express]
---

## Overview

The AI Service provides AI-powered content generation for the LFX platform using Claude Sonnet 4 via a LiteLLM proxy. It exposes two primary entry points: `generateMeetingAgenda` for structured meeting agenda generation and `generateNewsletter` for newsletter content drafting. The service is consumed by meeting, newsletter, and campaign workflows.

The service implements lazy environment variable resolution with memoization to ensure `dotenv` has finished loading before accessing configuration, and includes strict JSON schema validation for AI responses with fallback strategies for malformed output.

## Key Responsibilities

- Generate structured meeting agendas based on meeting type, title, project context, and user-provided context
- Generate draft newsletter content for editorial review
- Validate AI responses against strict JSON schemas with fallback heuristics
- Check AI service configuration availability before processing requests
- Log all AI operations with appropriate request context and metrics

## Dependencies

- LiteLLM proxy (OpenAI-compatible endpoint for Claude Sonnet 4 model access)
- Shared constants and interfaces from `@lfx-one/shared` package
- Logger service for structured logging

## Related Concepts

- [Meeting Service](./meeting-service.md) — consumes agenda generation
- [Newsletter Service](./newsletter-service.md) — consumes newsletter generation
- [Authentication](../decisions/auth0-authentication.md) — Bearer token required on all endpoints

## Citations

- Architecture: `docs/architecture/backend/ai-service.md`
- Source: `apps/lfx-one/src/server/services/ai.service.ts`

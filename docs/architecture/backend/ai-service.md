# AI Service Integration

## 🤖 Overview

The LFX One AI Service provides AI-backed content generation using a **Claude** model through a **LiteLLM proxy** — whichever one `AI_MODEL` names (see [Model Configuration](#model-configuration)). It now powers more than one feature: structured **meeting agenda** generation (based on meeting type, context, and project information), **newsletter content** generation, and **weekly-brief action-item extraction** (LFXV2-3043). The three public entry points are `generateMeetingAgenda`, `generateNewsletter`, and `extractBriefActionItems`, and the service is consumed by the meetings, newsletters, campaigns, and weekly-brief flows.

## 🏗 Architecture

### Service Architecture

```text
Frontend Request → Feature API → AI Service → LiteLLM Proxy → Claude (AI_MODEL)
     ↓             ↓             ↓             ↓
   Angular      Express.js    Business     OpenAI-Compatible
   Service      Controller     Logic           Proxy
```

The "Feature API" is whichever controller fronts the request: `meeting.controller.ts` (agenda generation), `newsletter.controller.ts` (newsletter generation), `weekly-brief.controller.ts` (indirectly — its service layer, not the controller, calls `extractBriefActionItems`), and the campaigns flow, which also routes AI briefs through this layer.

### Core Components

- **AI Service** (`/server/services/ai.service.ts`): Core business logic for AI integration; exposes `generateMeetingAgenda`, `generateNewsletter`, and `extractBriefActionItems`
- **Feature controllers**: `meeting.controller.ts` and `newsletter.controller.ts` expose the HTTP endpoints for AI-powered features directly; `weekly-brief.controller.ts` never calls `AiService` itself — `WeeklyBriefService.getActionItems` does, on its behalf; the campaigns flow consumes the same service
- **LiteLLM Proxy**: OpenAI-compatible proxy for Claude model access; it accepts only the short model names it publishes in its own `model_list`
- **Shared Interfaces** (`@lfx-one/shared`): Type-safe request/response contracts

## 🔧 Implementation Details

### AI Service Configuration

`MeetingController` constructs `AiService` at **class field initialization** time (during ESM import), which runs **before** `process.loadEnvFile()` in `server.ts`. Reading `process.env` in the constructor or in `readonly` field initializers can therefore capture empty values. `AiService` follows the same pattern as `CdpService`: **lazy private getters** memoized with `??=` on first access (after the env file has loaded).

```typescript
export class AiService {
  // Resolved lazily on first access so process.loadEnvFile has finished loading,
  // then memoized — env is stable after startup.
  private _aiProxyUrl: string | undefined;
  private _aiKey: string | undefined;

  private get aiProxyUrl(): string {
    return (this._aiProxyUrl ??= process.env['AI_PROXY_URL'] || '');
  }

  private get aiKey(): string {
    return (this._aiKey ??= process.env['AI_API_KEY'] || '');
  }

  public isAiConfigured(): boolean {
    return !!this.aiProxyUrl && !!this.aiKey;
  }
}
```

Defaults are empty strings, not placeholder URLs/keys — so missing env never silently routes to a wrong endpoint or sends a fake key. `generateMeetingAgenda` checks `isAiConfigured()` up front and throws `"AI service not configured: AI_PROXY_URL and AI_API_KEY environment variables are required"` when either variable is unset; `makeAiRequest` repeats the guard as defense-in-depth. The thrown error is a plain `Error`, so the default `apiErrorHandler` branch surfaces it to API clients as a generic `500 INTERNAL_ERROR` — by design, since env-var details should not leak to end users. The specific message is logged server-side (CloudWatch) with the request context for ops to act on. Production and CI must set `AI_PROXY_URL` and `AI_API_KEY` to real values (see `.env.example`).

### Request/Response Schema

#### Generate Agenda Request

```typescript
export interface GenerateAgendaRequest {
  meetingType?: MeetingType; // Meeting type enum (BOARD, TECHNICAL, etc.)
  title?: string; // Meeting title/topic
  projectName?: string; // Project name for context
  context?: string; // Additional context from user — required when `title` is absent
  maxCharacters?: number; // Max agenda length (default: MEETING_AGENDA_MAX_LENGTH)
}
```

Every descriptor is optional, and that is deliberate rather than lax: the composer's Agenda &
Resources section is reachable before a type is chosen, edit mode drops the rail's section locking so
the organizer can ask for an agenda having just cleared the title, and the client's project context
resolves asynchronously. What the endpoint does require is **enough signal to write a useful agenda —
a title or a free-text goal**. `MeetingController.generateAgenda` rejects a body carrying neither with
a `400` naming both fields; the prompt builder omits whatever else is missing.

Server-side normalization runs before the prompt is built, so a caller cannot rely on sending the
values through untouched:

| Input                             | Handling                                                                                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meetingType`                     | Narrowed to the `MeetingType` enum, or **dropped**. It has a closed value set, so an unrecognized value carries no signal — `AiService.getMeetingTypeDescription` already falls back to a generic descriptor.                                                                         |
| `title`, `context`, `projectName` | Trimmed; dropped when empty; **truncated** to `MEETING_AGENDA_PROMPT_MAX_LENGTH` (1000). Truncated rather than dropped so an over-budget title with no goal can still satisfy the title-or-context rule. Truncation is logged (field and lengths only — the values are user content). |
| `maxCharacters`                   | Floored; anything non-finite or outside `1..MEETING_AGENDA_MAX_LENGTH` (2000) **falls back to the default** rather than being pinned to the nearest bound. The value reaches the model twice — as `maxLength` in the response schema and interpolated into the prompt.                |

The route also carries a **per-user AI limiter** (`aiRateLimiter`, `middleware/rate-limit.middleware.ts`)
on top of the global `/api` one: 10 generations per minute, keyed on the OIDC `sub` and falling back
to a masked IP for anonymous callers, because every call costs a LiteLLM completion. The counter lives
in the default in-process store, so the effective ceiling is `limit × replicas`. The limiter is not
applied to the other LiteLLM callers (newsletter generation, weekly-brief extraction) — those are
reached from different modules and are bounded only by the global limiter.

#### Generate Agenda Response

```typescript
export interface GenerateAgendaResponse {
  agenda: string; // Generated meeting agenda content
  estimatedDuration: number; // Estimated meeting duration in minutes
}
```

#### Generate Newsletter

The service also exposes `generateNewsletter(req, request: GenerateNewsletterRequest): Promise<GenerateNewsletterResponse>` for AI newsletter drafting, consumed by `newsletter.controller.ts`. Its request/response contracts live in `@lfx-one/shared`, and the implementation mirrors the agenda path: the same `isAiConfigured()` guard, JSON-schema-validated response, and the parse → fallback strategy described below (with its own `buildNewsletterPrompt`/`extractNewsletter`).

#### Extract Brief Action Items

`extractBriefActionItems(req, request: ExtractActionItemsRequest): Promise<ExtractActionItemsResponse>` (LFXV2-3043) reads a weekly brief's `brief_text` and extracts up to `WEEKLY_BRIEF_ACTION_ITEMS_MAX` concrete follow-up items (`{text, suggested_owner_role?}`), consumed by `WeeklyBriefService.getActionItems` — never called directly from a controller. It follows the same `isAiConfigured()`/structured-JSON-schema/throw-on-failure skeleton as the two methods above (using the tighter `AI_REQUEST_CONFIG.EXTRACTION_TIMEOUT_MS` bound, since it runs on a GET page-load path rather than a user-initiated POST); unlike them, its caller (`WeeklyBriefService`) deliberately catches the throw and degrades to an empty item list rather than propagating an error to the brief page, and caches successful (including legitimately empty) extractions in Valkey per `(committeeId, brief.uid, brief.revision)` so repeated reads of the same brief revision don't re-invoke the AI proxy. `committeeId` is part of the key because the mock-mode brief fixture reuses the same `uid`/`revision` for every committee. The endpoint also skips extraction entirely — returning an empty list rather than calling the AI proxy uncached — whenever Valkey isn't configured (`VALKEY_URL` unset); this only covers the unconfigured case, not a configured-but-currently-unreachable Valkey.

### JSON Schema Validation

The service uses strict JSON schema validation to ensure reliable AI responses:

```typescript
response_format: {
  type: 'json_schema',
  json_schema: {
    name: 'meeting_agenda',
    description: 'Generated meeting agenda with estimated duration',
    schema: {
      type: 'object',
      properties: {
        agenda: {
          type: 'string',
          description: 'Well-structured meeting agenda with time allocations'
        },
        duration: {
          type: 'number',
          description: 'Total estimated meeting duration in minutes'
        }
      },
      required: ['agenda', 'duration'],
      additionalProperties: false
    }
  },
  strict: true
}
```

## 🚀 API Endpoints

### Generate Meeting Agenda

**Endpoint**: `POST /api/meetings/generate-agenda`

**Authentication**: Required (Bearer token)

**Rate limit**: `aiRateLimiter` — 10 requests per minute per user

**Request Body** — every field is optional, but at least one of `title` / `context` must be present:

```json
{
  "meetingType": "TECHNICAL",
  "title": "Q1 Architecture Review",
  "projectName": "LFX Platform",
  "context": "Review microservices architecture and discuss scaling plans"
}
```

A body carrying only a goal is equally valid:

```json
{ "context": "Agree on the release date and unblock the remaining Q3 roadmap items" }
```

**Response**:

```json
{
  "agenda": "**Meeting Objective**: Q1 Architecture Review\n\n**Agenda Items**:\n1. **System Overview** (10 min)...",
  "estimatedDuration": 60
}
```

**Error Responses**:

- `400 Bad Request`: Neither `title` nor `context` was supplied (both fields are named in the error)
- `401 Unauthorized`: Invalid or missing authentication
- `429 Too Many Requests`: Per-user AI limiter exhausted
- `500 Internal Server Error`: AI service failure (including an unconfigured `AI_PROXY_URL` / `AI_API_KEY`, which is surfaced generically and logged server-side)

## 🔐 Security & Authentication

### API Protection

```typescript
// Bearer token middleware applied to all API routes
app.use('/api', extractBearerToken);

// Protected meeting agenda endpoint
router.post('/generate-agenda', async (req: Request, res: Response, next: NextFunction) => {
  // Validates authentication before processing
});
```

### Data Sanitization

- **Request Logging**: Sensitive data automatically redacted from logs
- **Input Validation**: All user inputs validated before AI processing
- **Response Filtering**: AI responses validated against strict schema

## 🛠 Configuration

### Environment Variables

```bash
# AI Service Configuration
AI_PROXY_URL={{https://lite-llm-url}}/chat/completions
AI_API_KEY=your-ai-api-key
# Optional — unset or empty falls back to AI_MODEL in ai.constants.ts
AI_MODEL=claude-sonnet-4-5
```

### Model Configuration

The model is a deploy-time setting. `getAiModel()` (`server/helpers/ai-model.helper.ts`) reads the
`AI_MODEL` env var once, trims it, and falls back to the `AI_MODEL` constant in `ai.constants.ts`
when it is unset or empty. The chart sets `environment.AI_MODEL` to that same constant, so the key
changes nothing on deploy; a model swap is then an argocd values change rather than a code change,
a release and an image bump. `ai.service.ts` and `campaign-proxy.service.ts` both read the model
from the helper, so the two cannot disagree. At startup the server logs one `ai_model_config` line
with the model, whether it came from the env var or the default, and the sampling mode it resolved
to — the model name only, never `AI_API_KEY` or `AI_PROXY_URL`.

`AI_MODEL` must name a model the LiteLLM proxy actually publishes. The proxy's own `model_list`
lives in `lfx-v2-argocd` at `values/global/lfit-litellm.yaml`, and every name it publishes is
short — `claude-sonnet-5-5`, `claude-sonnet-4`, `amazon-nova-pro`. A provider-prefixed Bedrock id
appears in that file only on the other side of the mapping, as the `litellm_params.model` each
short name resolves to:

```yaml
- model_name: 'claude-sonnet-4-5' # what a caller sends
  litellm_params:
    model: 'bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0' # where it routes
```

Sending the routing destination asks the router for a model it publishes no deployment for, and
that answers `429` rather than a `400` that would name the real problem — the failure mode in #4333,
where every AI feature returned `AI streaming request failed (429)`. The startup log warns when the
configured name is not lower-case letters, digits and hyphens, which catches both spellings of a
Bedrock routing id; a well-formed name the proxy does not publish still passes, and only argocd's
`model_list` can rule it out.

Read the status code when generation fails: a `429` is the model name not matching anything the
proxy serves (or a genuine rate limit), a `400` is the request body being rejected with auth fine,
and a `401` is the key itself being refused. Neither the host nor the published name can be checked
from this repo — both live in argocd — so the two have to move together; #4087 is the case where
the host moved alone. `litellm.tools.lfx.dev` is the retired OCI instance from before that move: it
routed on the bare inference-profile id and answered `401` to a prefixed name. Anything still
pointing at that host is stale whichever model name it sends.

A published name is necessary but not sufficient: the list spans two sampling contracts.
Anthropic's [extended-thinking doc](https://platform.claude.com/docs/en/build-with-claude/thinking)
lists Claude Opus 4.8 and Opus 4.7 alongside Sonnet 5.5, Sonnet 5 and Haiku 5.5 as returning a `400`
on a non-default `temperature`, `top_p` or `top_k`, on every request, thinking or not. The proxy
does not absorb that — `lfit-litellm.yaml`'s `litellm_settings` sets no `drop_params`, so the value
reaches Bedrock as sent. So no send site sets `temperature` itself: all six spread
`getAiSamplingParams()`, which looks the model up in `AI_SAMPLING_COMPATIBILITY` (first match wins):

| Model family                                              | Sampling sent                              |
| --------------------------------------------------------- | ------------------------------------------ |
| Claude Sonnet 4/4.5/4.6, Opus 4/4.1/4.5/4.6, Haiku 4.5    | `temperature` (`AI_REQUEST_CONFIG`), alone |
| Claude Opus 4.7 or later, any 5-series Claude model       | none                                       |
| Anything else — a newer family, a non-Claude name, a typo | none                                       |

The table fails safe: only an allowlist row grants `temperature`, so a model released after it was
written loses nothing but the tuned temperature, where sending one would cost a `400` on every AI
feature. `top_p` is never sent — the accepting 4.x families take `temperature` or `top_p` but not
both, and only `temperature` has ever been tuned. `ai.constants.spec.ts` pins the table, including
every family the doc names.

`lfx-v2-campaign-service` names its own model in an `AI_MODEL` env var, set in argocd, and builds
its own request body with an unconditional `temperature` field (`internal/platform/llm/client.go`,
no `omitempty`). The two services are not currently on the same name: argocd pins campaign-service
to `claude-sonnet-5-5` (`values/global/lfx-v2-campaign-service.yaml`) while this repo defaults to
`claude-sonnet-4-5`. By the paragraph above, that service's pairing is the one that returns `400`.
Closing the gap is a change in that repo — a name that is neither Claude Opus 4.7 or later nor
5-series, or dropping `temperature` from its request body — not one this repo can make.

```typescript
// AI Constants (/packages/shared/src/constants/ai.constants.ts)
export const AI_MODEL = 'claude-sonnet-4-5'; // default when the AI_MODEL env var is unset or empty

export const AI_REQUEST_CONFIG = {
  MAX_TOKENS: 4000,
  TEMPERATURE: 0.7,
  TIMEOUT_MS: 120_000, // default AbortSignal.timeout bound — generateMeetingAgenda only (4,000-token budget)
  NEWSLETTER_TIMEOUT_MS: 240_000, // generateNewsletter's own bound, sized for its larger 12,000-token budget
  EXTRACTION_TIMEOUT_MS: 15_000, // tighter bound for extractBriefActionItems (GET page-load path)
};

export const DURATION_ESTIMATION = {
  BASE_DURATION: 15, // Opening/closing time in minutes
  TIME_PER_ITEM: 10, // Average time per agenda item in minutes
  MINIMUM_DURATION: 30, // Minimum meeting duration in minutes
  MAXIMUM_DURATION: 240, // Maximum meeting duration in minutes (4 hours)
};
```

### System Prompt

```typescript
export const AI_AGENDA_SYSTEM_PROMPT = `You are an expert meeting facilitator for open source projects. 
Generate professional, well-structured meeting agendas that include:

1. Clear objectives and expected outcomes
2. Time allocations for each agenda item
3. Appropriate agenda items based on meeting type
4. Consideration for open source project governance

You must respond with a valid JSON object containing:
- agenda: A detailed meeting agenda with markdown formatting
- duration: Total estimated duration in minutes (15-240 range)

Focus on transparency, collaboration, and effective time management.`;
```

## 🔄 Integration Workflow

### Frontend Integration

```typescript
// Composer agenda field
public async generateAiAgenda(): Promise<void> {
  // Every descriptor is sent as-is, including the ones that are still empty — the server treats an
  // absent title or type as "not chosen yet" rather than as a bad request. The client mirrors the
  // server's one hard rule (a title or a goal) so the button is disabled rather than the request
  // failing.
  const request: GenerateAgendaRequest = {
    meetingType: this.form().get('meeting_type')?.value,
    title: this.form().get('title')?.value,
    projectName: this.projectService.project()?.name,
    context: this.form().get('aiPrompt')?.value
  };

  this.meetingService.generateAgenda(request)
    .subscribe(response => {
      // Set generated agenda and duration
      this.form().get('agenda')?.setValue(response.agenda);
      this.setAiEstimatedDuration(response.estimatedDuration);
    });
}
```

### Backend Processing

```typescript
// AI Service Implementation
public async generateMeetingAgenda(request: GenerateAgendaRequest): Promise<GenerateAgendaResponse> {
  const prompt = this.buildPrompt(request);
  const chatRequest: OpenAIChatRequest = {
    model: this.model,
    messages: [
      { role: 'system', content: AI_AGENDA_SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    response_format: { /* JSON schema */ },
    max_tokens: AI_REQUEST_CONFIG.MAX_TOKENS,
    ...getAiSamplingParams(), // { temperature } only for a family that accepts it
  };

  const response = await this.makeAiRequest(chatRequest);
  return this.extractAgendaAndDuration(response);
}
```

## 🔍 Error Handling & Fallbacks

### Response Parsing Strategy

1. **Primary**: JSON schema with strict validation
2. **Fallback**: Parse JSON manually if schema fails
3. **Emergency**: Extract plain text with heuristic duration estimation

```typescript
private extractAgendaAndDuration(response: OpenAIChatResponse): GenerateAgendaResponse {
  try {
    // Primary: Parse strict JSON schema response
    const parsed = JSON.parse(content.trim());
    return {
      agenda: parsed.agenda.trim(),
      estimatedDuration: parsed.duration
    };
  } catch (parseError) {
    // Fallback: Extract text with estimated duration
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const estimatedItems = lines.filter(line => line.match(/^[#\-*\d]/)).length;
    const fallbackDuration = DURATION_ESTIMATION.BASE_DURATION +
                            estimatedItems * DURATION_ESTIMATION.TIME_PER_ITEM;

    return {
      agenda: content.trim(),
      estimatedDuration: Math.max(DURATION_ESTIMATION.MINIMUM_DURATION, fallbackDuration)
    };
  }
}
```

### Logging & Monitoring

```typescript
// Request logging with context
serverLogger.info('Generating meeting agenda', {
  meetingType: request.meetingType,
  title: request.title,
  hasContext: !!request.context,
  projectName: request.projectName,
});

// Success logging with metrics
serverLogger.info('Successfully generated meeting agenda', {
  estimatedDuration: result.estimatedDuration,
});

// Error logging with details
serverLogger.error('Failed to generate meeting agenda', { error });
```

## 🎯 Best Practices

### Development Guidelines

1. **Input Validation**: Always validate requests before AI processing
2. **Error Handling**: Implement comprehensive error handling with fallbacks
3. **Logging**: Log all AI operations with appropriate detail levels
4. **Rate Limiting**: Consider implementing rate limiting for AI endpoints
5. **Caching**: Cache responses for identical requests to reduce API costs

### Security Considerations

1. **Authentication**: All AI endpoints require valid authentication
2. **Input Sanitization**: Sanitize user inputs to prevent prompt injection
3. **Response Validation**: Validate AI responses against expected schemas
4. **API Key Management**: Secure storage and rotation of AI API keys; never ship real keys in source. Unset env vars produce empty defaults and a clean runtime failure — no placeholder keys in code.
5. **Audit Logging**: Log all AI requests for audit and debugging purposes

## 📊 Performance & Monitoring

### Key Metrics

- **Response Time**: AI request/response latency
- **Success Rate**: Percentage of successful agenda generations
- **Error Rate**: Rate of AI service failures and fallbacks
- **Token Usage**: API token consumption for cost monitoring

### Health Monitoring

```typescript
// Readiness check integration
app.get('/readyz', (req, res) => {
  const healthStatus = {
    ai_service: {
      configured: !!process.env['AI_PROXY_URL'] && !!process.env['AI_API_KEY'],
      model: getAiModel(),
    },
  };
  res.json(healthStatus);
});
```

## 🔗 Related Documentation

- [Backend Architecture Overview](./README.md)
- [Meeting API Routes](./README.md#meeting-management)
- [Shared Interfaces](../shared/package-architecture.md)
- Environment Configuration - chart values in `charts/lfx-self-serve/README.md`; deployed values in `lfx-v2-argocd` (`values/<env>/lfx-v2-ui.yaml`).

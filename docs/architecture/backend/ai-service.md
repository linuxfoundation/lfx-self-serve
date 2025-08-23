# AI Service Integration

## 🤖 Overview

The LFX PCC AI Service provides intelligent meeting agenda generation using **Claude Sonnet 4** through a **LiteLLM proxy**. The service integrates with the meeting creation workflow to automatically generate professional, structured meeting agendas based on meeting type, context, and project information.

## 🏗 Architecture

### Service Architecture

```text
Frontend Request → Meeting API → AI Service → LiteLLM Proxy → Claude Sonnet 4
     ↓              ↓              ↓              ↓
   Angular       Express.js     Business      OpenAI-Compatible
   Service       Controller      Logic           Proxy
```

### Core Components

- **AI Service** (`/server/services/ai.service.ts`): Core business logic for AI integration
- **Meeting API** (`/server/routes/meetings.ts`): HTTP endpoints for AI-powered features
- **LiteLLM Proxy**: OpenAI-compatible proxy for Claude Sonnet model access
- **Shared Interfaces** (`@lfx-pcc/shared`): Type-safe request/response contracts

## 🔧 Implementation Details

### AI Service Configuration

```typescript
export class AiService {
  private readonly aiProxyUrl: string;
  private readonly model = AI_MODEL; // 'us.anthropic.claude-sonnet-4-20250514-v1:0'
  private readonly aiKey = process.env['AI_API_KEY'] || '';

  public constructor() {
    this.aiProxyUrl = process.env['AI_PROXY_URL'] || '';
    if (!this.aiProxyUrl || !this.aiKey) {
      throw new Error('AI configuration environment variables are required');
    }
  }
}
```

### Request/Response Schema

#### Generate Agenda Request

```typescript
export interface GenerateAgendaRequest {
  meetingType: MeetingType; // Meeting type enum (BOARD, TECHNICAL, etc.)
  title: string; // Meeting title/topic
  projectName: string; // Project name for context
  context?: string; // Additional context from user
}
```

#### Generate Agenda Response

```typescript
export interface GenerateAgendaResponse {
  agenda: string; // Generated meeting agenda content
  estimatedDuration: number; // Estimated meeting duration in minutes
}
```

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

**Request Body**:

```json
{
  "meetingType": "TECHNICAL",
  "title": "Q1 Architecture Review",
  "projectName": "LFX Platform",
  "context": "Review microservices architecture and discuss scaling plans"
}
```

**Response**:

```json
{
  "agenda": "**Meeting Objective**: Q1 Architecture Review\n\n**Agenda Items**:\n1. **System Overview** (10 min)...",
  "estimatedDuration": 60
}
```

**Error Responses**:

- `400 Bad Request`: Missing required fields
- `401 Unauthorized`: Invalid or missing authentication
- `500 Internal Server Error`: AI service failure

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
```

### Model Configuration

```typescript
// AI Constants (/packages/shared/src/constants/ai.constants.ts)
export const AI_MODEL = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

export const AI_REQUEST_CONFIG = {
  MAX_TOKENS: 4000,
  TEMPERATURE: 0.3,
};

export const DURATION_ESTIMATION = {
  BASE_DURATION: 30, // Base meeting duration in minutes
  TIME_PER_ITEM: 5, // Additional time per agenda item
  MINIMUM_DURATION: 15, // Minimum meeting duration
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
// Meeting Form Component
public async generateAiAgenda(): Promise<void> {
  const request: GenerateAgendaRequest = {
    meetingType: this.form().get('meeting_type')?.value,
    title: this.form().get('topic')?.value,
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
    temperature: AI_REQUEST_CONFIG.TEMPERATURE
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
4. **API Key Management**: Secure storage and rotation of AI API keys
5. **Audit Logging**: Log all AI requests for audit and debugging purposes

## 📊 Performance & Monitoring

### Key Metrics

- **Response Time**: AI request/response latency
- **Success Rate**: Percentage of successful agenda generations
- **Error Rate**: Rate of AI service failures and fallbacks
- **Token Usage**: API token consumption for cost monitoring

### Health Monitoring

```typescript
// Health check integration
app.get('/api/health', (req, res) => {
  const healthStatus = {
    ai_service: {
      configured: !!process.env['AI_PROXY_URL'] && !!process.env['AI_API_KEY'],
      model: AI_MODEL,
    },
  };
  res.json(healthStatus);
});
```

## 🔗 Related Documentation

- [Backend Architecture Overview](./README.md)
- [Meeting API Routes](../../CLAUDE.md#api-routes)
- [Shared Interfaces](../shared/package-architecture.md)
- [Environment Configuration](../../deployment.md#environment-variables)

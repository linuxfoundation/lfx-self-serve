// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AI_AGENDA_SYSTEM_PROMPT,
  AI_MODEL,
  AI_NEWSLETTER_SYSTEM_PROMPT,
  AI_REQUEST_CONFIG,
  DURATION_ESTIMATION,
  NEWSLETTER_AI_MAX_TOKENS,
} from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import {
  GenerateAgendaRequest,
  GenerateAgendaResponse,
  GenerateNewsletterRequest,
  GenerateNewsletterResponse,
  OpenAIChatRequest,
  OpenAIChatResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';

export class AiService {
  private readonly model = AI_MODEL;

  // Resolved lazily on first access so dotenv has finished loading,
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

  public async generateMeetingAgenda(req: Request, request: GenerateAgendaRequest): Promise<GenerateAgendaResponse> {
    this.assertConfigured();

    const startTime = logger.startOperation(req, 'generate_meeting_agenda', {
      meetingType: request.meetingType,
      title: request.title,
      hasContext: !!request.context,
      projectName: request.projectName,
    });

    try {
      const prompt = this.buildPrompt(request);
      const chatRequest: OpenAIChatRequest = {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: AI_AGENDA_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: AI_REQUEST_CONFIG.MAX_TOKENS,
        temperature: AI_REQUEST_CONFIG.TEMPERATURE,
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
                  description:
                    'Well-structured meeting agenda with time allocations and clear objectives. ' +
                    `Must not exceed ${request.maxCharacters || 2000} characters.`,
                  maxLength: request.maxCharacters || 2000,
                },
                duration: {
                  type: 'number',
                  description: 'Total estimated meeting duration in minutes',
                },
              },
              required: ['agenda', 'duration'],
              additionalProperties: false,
            },
          },
          strict: true,
        },
      };

      const response = await this.makeAiRequest(chatRequest);
      const result = this.extractAgendaAndDuration(req, response);

      logger.success(req, 'generate_meeting_agenda', startTime, {
        estimatedDuration: result.estimatedDuration,
      });

      return result;
    } catch (error) {
      logger.error(req, 'generate_meeting_agenda', startTime, error);
      throw new Error('Failed to generate meeting agenda');
    }
  }

  public async generateNewsletter(req: Request, request: GenerateNewsletterRequest): Promise<GenerateNewsletterResponse> {
    this.assertConfigured();

    const startTime = logger.startOperation(req, 'generate_newsletter', {
      contextType: request.contextType,
      contextName: request.contextName,
      rawContentLength: request.rawContent?.length ?? 0,
      hasPromptOverride: !!request.systemPromptOverride,
    });

    try {
      const systemPrompt = request.systemPromptOverride?.trim() || AI_NEWSLETTER_SYSTEM_PROMPT;
      const userPrompt = this.buildNewsletterPrompt(request);

      const chatRequest: OpenAIChatRequest = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        // Newsletter-specific cap (~3x the shared agenda cap) so long-form
        // generations don't get truncated mid-output. Bumping the shared
        // AI_REQUEST_CONFIG.MAX_TOKENS would also raise the agenda ceiling,
        // which we don't want — agendas have a documented ~2k character
        // target and shouldn't drift larger.
        max_tokens: NEWSLETTER_AI_MAX_TOKENS,
        temperature: AI_REQUEST_CONFIG.TEMPERATURE,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'newsletter',
            description: 'Generated newsletter subject and HTML body',
            schema: {
              type: 'object',
              properties: {
                subject: {
                  type: 'string',
                  description: 'Concise, inbox-friendly subject line.',
                  maxLength: 200,
                },
                bodyHtml: {
                  type: 'string',
                  description:
                    'Newsletter HTML body. Only allowed tags: <p>, <br>, <strong>, <b>, <em>, <i>, <u>, <s>, <ol>, <ul>, <li>, <a>, <blockquote>, <h2>, <h3>.',
                  maxLength: 100_000,
                },
              },
              required: ['subject', 'bodyHtml'],
              additionalProperties: false,
            },
          },
          strict: true,
        },
      };

      const response = await this.makeAiRequest(chatRequest);
      const result = this.extractNewsletter(req, response);

      logger.success(req, 'generate_newsletter', startTime, {
        subjectLength: result.subject.length,
        bodyHtmlLength: result.bodyHtml.length,
      });

      return result;
    } catch (error) {
      logger.error(req, 'generate_newsletter', startTime, error);
      throw new Error('Failed to generate newsletter');
    }
  }

  private buildNewsletterPrompt(request: GenerateNewsletterRequest): string {
    const contextLabel = request.contextType === 'foundation' ? 'foundation' : 'project';
    const lines = [
      `Compose a newsletter for the ${request.contextName} ${contextLabel}.`,
      '',
      'Raw content from the Executive Director (transform this into a polished newsletter):',
      '"""',
      request.rawContent.trim(),
      '"""',
    ];
    return lines.join('\n');
  }

  private extractNewsletter(req: Request, response: OpenAIChatResponse): GenerateNewsletterResponse {
    if (!response.choices || response.choices.length === 0) {
      throw new Error('No newsletter generated');
    }

    const content = response.choices[0].message.content;

    if (!content || content.trim().length === 0) {
      throw new Error('Empty newsletter generated');
    }

    try {
      const parsed = JSON.parse(content.trim());

      if (!parsed.bodyHtml || typeof parsed.bodyHtml !== 'string') {
        throw new Error('Invalid bodyHtml in response');
      }

      const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';

      return {
        subject,
        bodyHtml: parsed.bodyHtml.trim(),
      };
    } catch (parseError) {
      // Log metadata only — never the AI-generated body itself (PII / draft content).
      logger.warning(req, 'generate_newsletter', 'Failed to parse JSON response, falling back to raw content', {
        contentLength: content.length,
        err: parseError,
      });

      // Fallback: treat the whole response as bodyHtml; leave subject empty so the user fills it in.
      return {
        subject: '',
        bodyHtml: content.trim(),
      };
    }
  }

  private buildPrompt(request: GenerateAgendaRequest): string {
    let prompt = `Generate a meeting agenda for a ${this.getMeetingTypeDescription(request.meetingType)} meeting`;
    prompt += ` titled "${request.title}" for the ${request.projectName} project.`;

    if (request.context) {
      prompt += ` Additional context: ${request.context}`;
    }

    prompt += '\n\nPlease create a professional, well-structured agenda that includes appropriate time allocations and clear objectives for each item.';

    if (request.maxCharacters) {
      prompt += ` The agenda must not exceed ${request.maxCharacters} characters.`;
    }

    return prompt;
  }

  private getMeetingTypeDescription(meetingType: MeetingType): string {
    switch (meetingType) {
      case MeetingType.BOARD:
        return 'board governance';
      case MeetingType.MAINTAINERS:
        return 'maintainers/technical steering committee';
      case MeetingType.MARKETING:
        return 'marketing and community outreach';
      case MeetingType.TECHNICAL:
        return 'technical working group';
      case MeetingType.LEGAL:
        return 'legal and compliance';
      case MeetingType.OTHER:
        return 'project team';
      case MeetingType.NONE:
        return 'general project';
      default:
        return 'project team';
    }
  }

  private assertConfigured(): void {
    if (!this.isAiConfigured()) {
      throw new Error('AI service not configured: AI_PROXY_URL and AI_API_KEY environment variables are required');
    }
  }

  private async makeAiRequest(request: OpenAIChatRequest): Promise<OpenAIChatResponse> {
    this.assertConfigured();

    const response = await fetch(this.aiProxyUrl, {
      method: 'POST',
      headers: {
        ['Content-Type']: 'application/json',
        ['Authorization']: `Bearer ${this.aiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  private extractAgendaAndDuration(req: Request, response: OpenAIChatResponse): GenerateAgendaResponse {
    if (!response.choices || response.choices.length === 0) {
      throw new Error('No agenda generated');
    }

    const content = response.choices[0].message.content;

    if (!content || content.trim().length === 0) {
      throw new Error('Empty agenda generated');
    }

    try {
      // Parse the JSON response
      const parsed = JSON.parse(content.trim());

      if (!parsed.agenda || typeof parsed.agenda !== 'string') {
        throw new Error('Invalid agenda format in response');
      }

      if (!parsed.duration || typeof parsed.duration !== 'number') {
        throw new Error('Invalid duration format in response');
      }

      // Cap duration between minimum and maximum limits
      const cappedDuration = Math.max(DURATION_ESTIMATION.MINIMUM_DURATION, Math.min(parsed.duration, DURATION_ESTIMATION.MAXIMUM_DURATION));

      return {
        agenda: parsed.agenda.trim(),
        estimatedDuration: cappedDuration,
      };
    } catch (parseError) {
      logger.warning(req, 'generate_meeting_agenda', 'Failed to parse JSON response, falling back to text extraction', {
        content: content.substring(0, 100),
        err: parseError,
      });

      // Fallback to treating the entire content as agenda with heuristic duration
      const lines = content.split('\n').filter((line) => line.trim().length > 0);
      const estimatedItems = lines.filter((line) => line.match(/^[#\-*\d]/)).length;
      const fallbackDuration = DURATION_ESTIMATION.BASE_DURATION + estimatedItems * DURATION_ESTIMATION.TIME_PER_ITEM;

      // Cap fallback duration between minimum and maximum limits
      const cappedFallbackDuration = Math.max(DURATION_ESTIMATION.MINIMUM_DURATION, Math.min(fallbackDuration, DURATION_ESTIMATION.MAXIMUM_DURATION));

      return {
        agenda: content.trim(),
        estimatedDuration: cappedFallbackDuration,
      };
    }
  }
}

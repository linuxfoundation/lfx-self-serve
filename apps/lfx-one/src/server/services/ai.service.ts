// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AI_AGENDA_SYSTEM_PROMPT,
  AI_BRIEF_ACTION_ITEMS_SYSTEM_PROMPT,
  AI_MODEL,
  AI_NEWSLETTER_SYSTEM_PROMPT,
  AI_REQUEST_CONFIG,
  DURATION_ESTIMATION,
  MEETING_AGENDA_MAX_LENGTH,
  NEWSLETTER_AI_MAX_TOKENS,
  WEEKLY_BRIEF_ACTION_ITEM_OWNER_ROLE_MAX_LENGTH,
  WEEKLY_BRIEF_ACTION_ITEM_TEXT_MAX_LENGTH,
  WEEKLY_BRIEF_ACTION_ITEMS_MAX,
} from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import {
  ExtractActionItemsRequest,
  ExtractActionItemsResponse,
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

  public async generateMeetingAgenda(req: Request, request: GenerateAgendaRequest): Promise<GenerateAgendaResponse> {
    this.assertConfigured();

    const startTime = logger.startOperation(req, 'generate_meeting_agenda', {
      meetingType: request.meetingType,
      title: request.title,
      hasContext: !!request.context,
      projectName: request.projectName,
    });

    try {
      // Resolved once: the same cap is asked of the model (in the schema and the prompt) and enforced
      // on the way back out, so the three can't disagree.
      const agendaMaxCharacters = request.maxCharacters || MEETING_AGENDA_MAX_LENGTH;
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
                    'Well-structured meeting agenda with time allocations and clear objectives. ' + `Must not exceed ${agendaMaxCharacters} characters.`,
                  maxLength: agendaMaxCharacters,
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
      const result = this.extractAgendaAndDuration(req, response, agendaMaxCharacters);

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

      // NEWSLETTER_TIMEOUT_MS, not the shared default — sized for this method's larger
      // NEWSLETTER_AI_MAX_TOKENS completion (PR #1362 review — Copilot, Cursor Bugbot, @dealako).
      const response = await this.makeAiRequest(chatRequest, AI_REQUEST_CONFIG.NEWSLETTER_TIMEOUT_MS);
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

  /**
   * Extracts actionable follow-up items from a weekly brief's `brief_text`. Follows the same
   * assertConfigured/startOperation/try-throw skeleton as generateMeetingAgenda and
   * generateNewsletter — this method still throws on misconfiguration or failure like every
   * other AiService caller. The "extraction failures degrade silently" requirement (LFXV2-3043)
   * is the caller's (WeeklyBriefService.getActionItems) responsibility, not AiService's.
   */
  public async extractBriefActionItems(req: Request, request: ExtractActionItemsRequest): Promise<ExtractActionItemsResponse> {
    this.assertConfigured();

    const startTime = logger.startOperation(req, 'extract_brief_action_items', {
      briefTextLength: request.brief_text.length,
    });

    try {
      const chatRequest: OpenAIChatRequest = {
        model: this.model,
        messages: [
          { role: 'system', content: AI_BRIEF_ACTION_ITEMS_SYSTEM_PROMPT },
          { role: 'user', content: `Weekly committee brief:\n"""\n${request.brief_text.trim()}\n"""` },
        ],
        max_tokens: AI_REQUEST_CONFIG.MAX_TOKENS,
        temperature: AI_REQUEST_CONFIG.TEMPERATURE,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'brief_action_items',
            description: 'Actionable follow-up items extracted from a weekly committee brief',
            schema: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  maxItems: WEEKLY_BRIEF_ACTION_ITEMS_MAX,
                  items: {
                    type: 'object',
                    properties: {
                      text: {
                        type: 'string',
                        description: 'Concise, actionable follow-up item text',
                        maxLength: WEEKLY_BRIEF_ACTION_ITEM_TEXT_MAX_LENGTH,
                      },
                      // Nullable, not optional — OpenAI-style strict mode (strict: true +
                      // additionalProperties: false below) requires every key in `properties` to
                      // also appear in `required`; expressing "the model may not know this" via
                      // omission (as the sibling agenda/newsletter schemas never needed to) rejects
                      // every real call. See PR #1362 review — Cursor Bugbot + @dealako.
                      suggested_owner_role: {
                        type: ['string', 'null'],
                        description: 'Suggested owner role/persona for the item, when inferable (e.g. "chair", "maintainer"), or null if not inferable',
                        maxLength: WEEKLY_BRIEF_ACTION_ITEM_OWNER_ROLE_MAX_LENGTH,
                      },
                    },
                    required: ['text', 'suggested_owner_role'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['items'],
              additionalProperties: false,
            },
          },
          strict: true,
        },
      };

      const response = await this.makeAiRequest(chatRequest, AI_REQUEST_CONFIG.EXTRACTION_TIMEOUT_MS);
      const result = this.extractBriefActionItemsFromResponse(response);

      logger.success(req, 'extract_brief_action_items', startTime, {
        itemCount: result.items.length,
      });

      return result;
    } catch (error) {
      // Deliberately no logger.error() here, unlike the sibling generate* methods above — this
      // method's only caller (WeeklyBriefService.getActionItems) always catches and degrades to
      // an empty list, then logs at WARN (the correct level per logging-patterns.md's "graceful
      // degradation" guidance). The original error's message is folded into the thrown error's
      // message below — a bare rethrow of a new generic Error would silently discard the real
      // cause (network failure, non-2xx status, schema rejection, JSON parse failure), leaving
      // every failure mode logged identically and undiagnosable from that WARN alone (PR #1362
      // review — Cursor Bugbot).
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract brief action items: ${cause}`);
    }
  }

  private extractBriefActionItemsFromResponse(response: OpenAIChatResponse): ExtractActionItemsResponse {
    if (!response.choices || response.choices.length === 0) {
      throw new Error('No brief action items response generated');
    }

    const content = response.choices[0].message.content;

    if (!content || content.trim().length === 0) {
      throw new Error('Empty brief action items response generated');
    }

    const parsed = JSON.parse(content.trim());

    if (!Array.isArray(parsed.items)) {
      throw new Error('Invalid items array in brief action items response');
    }

    // The schema's maxLength values are a request to the model, not a guarantee about its
    // response — clamp defensively here too, since these strings get cached for the full TTL
    // and rendered into a fixed-layout Pending Actions row. Whitespace-only text is rejected
    // (not just trimmed) — an empty-after-trim item would still cache and render as a blank
    // row with a live Dismiss control (PR #1362 review — Cursor Bugbot + Copilot + @dealako).
    const items = parsed.items
      .filter(
        (item: unknown): item is { text: string; suggested_owner_role?: string } =>
          !!item && typeof (item as { text?: unknown }).text === 'string' && (item as { text: string }).text.trim().length > 0
      )
      .map((item: { text: string; suggested_owner_role?: string }) => ({
        text: item.text.trim().slice(0, WEEKLY_BRIEF_ACTION_ITEM_TEXT_MAX_LENGTH),
        suggested_owner_role:
          typeof item.suggested_owner_role === 'string' ? item.suggested_owner_role.trim().slice(0, WEEKLY_BRIEF_ACTION_ITEM_OWNER_ROLE_MAX_LENGTH) : undefined,
      }))
      .slice(0, WEEKLY_BRIEF_ACTION_ITEMS_MAX);

    return { items };
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

  /**
   * Every descriptor is optional, including the meeting type — in edit mode the composer's rail
   * imposes no section locking, so the organizer can ask for an agenda with the title cleared, and the
   * client's project context resolves asynchronously. Each clause is only appended when there's
   * something to say; the controller guarantees at least a title or a goal.
   */
  private buildPrompt(request: GenerateAgendaRequest): string {
    let prompt = `Generate a meeting agenda for a ${this.getMeetingTypeDescription(request.meetingType)} meeting`;

    if (request.title) {
      prompt += ` titled "${request.title}"`;
    }

    if (request.projectName) {
      prompt += ` for the ${request.projectName} project`;
    }

    prompt += '.';

    if (request.context) {
      prompt += ` Additional context: ${request.context}`;
    }

    prompt += '\n\nPlease create a professional, well-structured agenda that includes appropriate time allocations and clear objectives for each item.';

    if (request.maxCharacters) {
      prompt += ` The agenda must not exceed ${request.maxCharacters} characters.`;
    }

    return prompt;
  }

  /** `default` also covers an unset type — the helper is reachable before one is chosen. */
  private getMeetingTypeDescription(meetingType?: MeetingType): string {
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

  // AbortSignal.timeout, not an unbounded fetch — a hung LiteLLM proxy would otherwise hold the
  // request open for undici's ~300s default. `timeoutMs` defaults to the generous POST-path
  // bound (agenda/newsletter); extractBriefActionItems passes AI_REQUEST_CONFIG.EXTRACTION_TIMEOUT_MS
  // explicitly, since it runs on a GET page-load path where an unbounded or generously-bounded
  // wait is an availability risk, not just slowness.
  private async makeAiRequest(request: OpenAIChatRequest, timeoutMs: number = AI_REQUEST_CONFIG.TIMEOUT_MS): Promise<OpenAIChatResponse> {
    this.assertConfigured();

    const response = await fetch(this.aiProxyUrl, {
      method: 'POST',
      headers: {
        ['Content-Type']: 'application/json',
        ['Authorization']: `Bearer ${this.aiKey}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * @param maxCharacters Hard cap applied to the returned agenda.
   *
   * The cap is enforced here rather than trusted from the response schema's `maxLength` hint, which
   * the model is free to overshoot (`MAX_TOKENS` leaves ample room to), and which the text-extraction
   * fallback below bypasses entirely by returning the whole completion. That matters beyond tidiness:
   * the composer writes this string straight into its `description` control, which carries
   * `Validators.maxLength(MEETING_AGENDA_MAX_LENGTH)`. An over-length agenda would therefore make the
   * composer's whole form invalid and silently disable Save — the same class of dead button GH-1464
   * fixed for the AI goal, reached through the AI helper itself.
   */
  private extractAgendaAndDuration(req: Request, response: OpenAIChatResponse, maxCharacters: number): GenerateAgendaResponse {
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
        agenda: AiService.capAgendaLength(req, parsed.agenda.trim(), maxCharacters, 'json'),
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
        agenda: AiService.capAgendaLength(req, content.trim(), maxCharacters, 'text_fallback'),
        estimatedDuration: cappedFallbackDuration,
      };
    }
  }

  /**
   * Trims an agenda to the requested cap, logging when it had to. Truncated rather than rejected: a
   * shortened agenda is still a usable draft the organizer can edit, whereas a thrown error costs
   * them the whole generation.
   */
  private static capAgendaLength(req: Request, agenda: string, maxCharacters: number, source: 'json' | 'text_fallback'): string {
    if (agenda.length <= maxCharacters) {
      return agenda;
    }

    logger.warning(req, 'generate_meeting_agenda', 'Agenda exceeded the requested cap, truncating', {
      agenda_length: agenda.length,
      max_characters: maxCharacters,
      source,
    });

    return agenda.slice(0, maxCharacters);
  }
}

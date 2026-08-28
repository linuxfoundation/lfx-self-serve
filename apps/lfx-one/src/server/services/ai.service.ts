// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AI_AGENDA_SYSTEM_PROMPT,
  AI_BRIEF_ACTION_ITEMS_SYSTEM_PROMPT,
  AI_MODEL,
  AI_NEWSLETTER_SYSTEM_PROMPT,
  AI_REQUEST_CONFIG,
  DURATION_ESTIMATION,
  NEWSLETTER_AI_MAX_TOKENS,
  WEEKLY_BRIEF_ACTION_ITEM_OWNER_ROLE_MAX_LENGTH,
  WEEKLY_BRIEF_ACTION_ITEM_TEXT_MAX_LENGTH,
  WEEKLY_BRIEF_ACTION_ITEMS_MAX,
  AI_EMAIL_COPY_SYSTEM_PROMPT,
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
  EmailBriefCopy,
  EmailContentSection,
  GenerateEmailCopyRequest,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';

/**
 * Render generated sections to an email body.
 *
 * Ports sectionsToHTML from the wizard. Text is HTML-ESCAPED on the button path but rich_text is
 * passed through: the model is asked for HTML there, and escaping it would print tags at the
 * reader. That asymmetry is the reason this lives in one function rather than at each call site —
 * a second copy would eventually escape the wrong one.
 *
 * An unrecognised section type renders nothing rather than throwing: a body that silently omits
 * one block is recoverable by a refine, while a 500 loses the whole generation.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderEmailSections(sections: EmailContentSection[]): string {
  return sections
    .map((section) => {
      switch (section.type) {
        case 'rich_text':
          return section.html ?? '';
        case 'button': {
          const label = escapeHtml(section.text ?? 'Register');
          const href = encodeURI(section.url ?? '');
          return href === ''
            ? ''
            : `<p><a href="${href}" style="display:inline-block;padding:12px 24px;background:#0868ac;color:#ffffff;text-decoration:none;border-radius:4px">${label}</a></p>`;
        }
        default:
          return '';
      }
    })
    .filter((html) => html !== '')
    .join('\n');
}

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
  /**
   * Generate marketing email copy for a campaign brief.
   *
   * The `email-copy` half of an email brief, which `campaign-proxy.service.ts` has always
   * deferred to (LFXV2-3198): the Plan-tab scrape returns event details and never copy, so
   * without this an email brief carries nothing to send.
   *
   * Ported from lf-marketing-ops' email-creation wizard, with two deliberate departures. It uses
   * a JSON SCHEMA rather than the wizard's strip-fences-and-balance-braces parsing, because the
   * proxy enforces the shape and a malformed response fails loudly instead of half-parsing. And
   * it is SINGLE-SHOT rather than the wizard's multi-turn tool loop: a refine re-runs the whole
   * generation with `changeRequest` attached, which needs no conversation state and cannot drift
   * out of sync with a stored transcript.
   */
  public async generateEmailCopy(req: Request, request: GenerateEmailCopyRequest): Promise<EmailBriefCopy> {
    this.assertConfigured();

    const startTime = logger.startOperation(req, 'generate_email_copy', {
      eventName: request.eventName,
      isRefine: Boolean(request.changeRequest),
    });

    // The event facts the model may use. Assembled here rather than interpolated inline so the
    // "use only these facts" rule in the system prompt has one visible referent.
    const facts = [
      `Event: ${request.eventName}`,
      `Registration URL: ${request.eventUrl}`,
      request.campaignGoal ? `Goal: ${request.campaignGoal}` : '',
      request.targetAudience ? `Audience: ${request.targetAudience}` : '',
      request.valueProp ? `Value proposition: ${request.valueProp}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n');

    const userContent = request.changeRequest
      ? `${facts}\n\nChange request from the operator — apply it and regenerate the whole email:\n${request.changeRequest}`
      : facts;

    try {
      const chatRequest: OpenAIChatRequest = {
        model: this.model,
        messages: [
          { role: 'system', content: AI_EMAIL_COPY_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: AI_REQUEST_CONFIG.MAX_TOKENS,
        temperature: AI_REQUEST_CONFIG.TEMPERATURE,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'email_copy',
            description: 'Subject, preview text and ordered body sections for a marketing email',
            schema: {
              type: 'object',
              properties: {
                subject: { type: 'string' },
                preview_text: { type: 'string' },
                sections: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      html: { type: 'string' },
                      text: { type: 'string' },
                      url: { type: 'string' },
                    },
                    required: ['type'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['subject', 'preview_text', 'sections'],
              additionalProperties: false,
            },
          },
        },
      };

      const response = await this.makeAiRequest(chatRequest);
      const content = response.choices?.[0]?.message?.content;
      if (!content || content.trim() === '') {
        throw new Error('AI returned no email copy');
      }

      const parsed = JSON.parse(content) as {
        subject: string;
        preview_text: string;
        sections: EmailContentSection[];
      };

      const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
      const bodyHtml = renderEmailSections(sections);

      logger.success(req, 'generate_email_copy', startTime, { sectionCount: sections.length });

      return {
        subject: (parsed.subject ?? '').trim(),
        previewText: (parsed.preview_text ?? '').trim(),
        sections,
        bodyHtml,
        previewHtml: bodyHtml,
      };
    } catch (error) {
      logger.error(req, 'generate_email_copy', startTime, error);
      throw error;
    }
  }

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

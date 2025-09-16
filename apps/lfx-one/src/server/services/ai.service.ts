// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AI_AGENDA_SYSTEM_PROMPT, AI_MODEL, AI_REQUEST_CONFIG, DURATION_ESTIMATION } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import { GenerateAgendaRequest, GenerateAgendaResponse, OpenAIChatRequest, OpenAIChatResponse } from '@lfx-one/shared/interfaces';

import { serverLogger } from '../server';

export class AiService {
  private readonly aiProxyUrl: string;
  private readonly model = AI_MODEL;
  private readonly aiKey = process.env['AI_API_KEY'] || 'sk-proj-1234567890';

  public constructor() {
    this.aiProxyUrl = process.env['AI_PROXY_URL'] || 'https://api.openai.com/v1/chat/completions';
    if (!this.aiProxyUrl) {
      throw new Error('AI_PROXY_URL environment variable is required');
    }

    if (!this.aiKey) {
      throw new Error('AI_API_KEY environment variable is required');
    }
  }

  public async generateMeetingAgenda(request: GenerateAgendaRequest): Promise<GenerateAgendaResponse> {
    try {
      serverLogger.info('Generating meeting agenda', {
        meetingType: request.meetingType,
        title: request.title,
        hasContext: !!request.context,
        projectName: request.projectName,
      });

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
                  description: 'Well-structured meeting agenda with time allocations and clear objectives',
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
      const result = this.extractAgendaAndDuration(response);

      serverLogger.info('Successfully generated meeting agenda', {
        estimatedDuration: result.estimatedDuration,
      });

      return result;
    } catch (error) {
      serverLogger.error('Failed to generate meeting agenda', { error });
      throw new Error('Failed to generate meeting agenda');
    }
  }

  private buildPrompt(request: GenerateAgendaRequest): string {
    let prompt = `Generate a meeting agenda for a ${this.getMeetingTypeDescription(request.meetingType)} meeting`;
    prompt += ` titled "${request.title}" for the ${request.projectName} project.`;

    if (request.context) {
      prompt += ` Additional context: ${request.context}`;
    }

    prompt += '\n\nPlease create a professional, well-structured agenda that includes appropriate time allocations and clear objectives for each item.';

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

  private async makeAiRequest(request: OpenAIChatRequest): Promise<OpenAIChatResponse> {
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

  private extractAgendaAndDuration(response: OpenAIChatResponse): GenerateAgendaResponse {
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
      serverLogger.warn('Failed to parse JSON response, falling back to text extraction', {
        content: content.substring(0, 100),
        error: parseError,
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

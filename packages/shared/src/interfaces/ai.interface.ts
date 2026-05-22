// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingType } from '../enums';

/**
 * Request interface for AI agenda generation
 */
export interface GenerateAgendaRequest {
  /** Type of meeting for agenda generation */
  meetingType: MeetingType;
  /** Meeting title */
  title: string;
  /** Name of the project for contextualized agenda */
  projectName: string;
  /** Additional context or specific requirements */
  context?: string;
  /** Maximum characters allowed for the generated agenda */
  maxCharacters?: number;
}

/**
 * Response interface for AI agenda generation
 */
export interface GenerateAgendaResponse {
  /** Generated agenda content in markdown format */
  agenda: string;
  /** AI-estimated duration in minutes (30-240 range) */
  estimatedDuration: number;
}

/**
 * Request interface for AI newsletter generation
 */
export interface GenerateNewsletterRequest {
  /** Raw user-supplied content (bullets, paragraphs, links, snippets) */
  rawContent: string;
  /** Whether the newsletter is being composed in a foundation or project context */
  contextType: 'foundation' | 'project';
  /** Display name of the foundation or project (for prompt context) */
  contextName: string;
  /** Optional override for the system prompt — when omitted, the default is used */
  systemPromptOverride?: string;
}

/**
 * Response interface for AI newsletter generation
 */
export interface GenerateNewsletterResponse {
  /** Generated subject line */
  subject: string;
  /** Generated HTML body, constrained to the sanitizer's allowed tags */
  bodyHtml: string;
}

/**
 * OpenAI chat message interface
 */
export interface OpenAIChatMessage {
  /** Role of the message sender */
  role: 'system' | 'user' | 'assistant';
  /** Content of the message */
  content: string;
}

/**
 * OpenAI chat completion request interface
 */
export interface OpenAIChatRequest {
  /** Model identifier */
  model: string;
  /** Array of chat messages */
  messages: OpenAIChatMessage[];
  /** Maximum tokens to generate */
  max_tokens?: number;
  /** Sampling temperature for response variability */
  temperature?: number;
  /** Response format specification */
  response_format?: {
    /** Type of response format */
    type: 'text' | 'json_object' | 'json_schema';
    /** JSON schema definition when type is json_schema */
    json_schema?: {
      /** Schema name */
      name: string;
      /** Schema description */
      description?: string;
      /** JSON schema definition */
      schema: Record<string, any>;
    };
    /** Strict mode for JSON schema validation */
    strict?: boolean;
  };
}

/**
 * OpenAI chat completion response interface
 */
export interface OpenAIChatResponse {
  /** Array of response choices */
  choices: Array<{
    /** Generated message */
    message: {
      /** Content of the generated message */
      content: string;
    };
  }>;
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * System prompt for AI meeting agenda generation
 */
export const AI_AGENDA_SYSTEM_PROMPT = `You are an expert meeting facilitator and agenda creator for open source software projects and organizations. Your role is to generate well-structured, comprehensive meeting agendas that promote productive discussions and clear outcomes.

Key principles:
- Create agendas that are time-boxed and actionable
- Include clear objectives for each agenda item
- Structure items logically from administrative to strategic topics
- Ensure adequate time for discussion and decision-making
- Follow best practices for meeting facilitation

You must respond with a valid JSON object in this exact format:
{
  "agenda": "string containing the agenda with clear section headers, time allocations, and action-oriented language",
  "duration": "number representing the total estimated duration in minutes"
}

The agenda should be well-structured plain text with time allocations for each item. The duration should be the sum of all time allocations plus any buffer time needed. Do not include any text outside the JSON object.`;

/**
 * AI model configuration
 */
export const AI_MODEL = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

/**
 * AI request configuration
 */
export const AI_REQUEST_CONFIG = {
  MAX_TOKENS: 4000,
  TEMPERATURE: 0.7,
};

/**
 * Duration estimation configuration
 */
export const DURATION_ESTIMATION = {
  BASE_DURATION: 15, // Opening/closing time in minutes
  TIME_PER_ITEM: 10, // Average time per agenda item in minutes
  MINIMUM_DURATION: 30, // Minimum meeting duration in minutes
  MAXIMUM_DURATION: 240, // Maximum meeting duration in minutes (4 hours)
};

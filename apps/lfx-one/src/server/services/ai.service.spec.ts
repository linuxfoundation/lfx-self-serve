// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config — a real, unmocked
// import re-triggers the Angular JIT-compilation failure (matches weekly-brief.service.spec.ts's
// convention). Values below are real runtime constants this file's assertions depend on.
vi.mock('@lfx-one/shared/constants', () => ({
  AI_AGENDA_SYSTEM_PROMPT: 'agenda prompt',
  AI_BRIEF_ACTION_ITEMS_SYSTEM_PROMPT: 'brief action items prompt',
  AI_MODEL: 'mock-model',
  AI_NEWSLETTER_SYSTEM_PROMPT: 'newsletter prompt',
  AI_REQUEST_CONFIG: { MAX_TOKENS: 4000, TEMPERATURE: 0.7, TIMEOUT_MS: 30_000 },
  DURATION_ESTIMATION: { BASE_DURATION: 15, TIME_PER_ITEM: 10, MINIMUM_DURATION: 30, MAXIMUM_DURATION: 240 },
  NEWSLETTER_AI_MAX_TOKENS: 12_000,
  WEEKLY_BRIEF_ACTION_ITEM_OWNER_ROLE_MAX_LENGTH: 100,
  WEEKLY_BRIEF_ACTION_ITEM_TEXT_MAX_LENGTH: 300,
  WEEKLY_BRIEF_ACTION_ITEMS_MAX: 5,
}));
vi.mock('@lfx-one/shared/enums', () => ({
  MeetingType: { BOARD: 'board', MAINTAINERS: 'maintainers', MARKETING: 'marketing', TECHNICAL: 'technical', LEGAL: 'legal', OTHER: 'other', NONE: 'none' },
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));

import type { Request } from 'express';

import { AiService } from './ai.service';
import { logger } from './logger.service';

const req = {} as unknown as Request;

/** Builds a minimal OpenAI-shaped chat-completion Response stand-in. */
function mockChatResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  } as unknown as Response;
}

describe('AiService.extractBriefActionItems (LFXV2-3043)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: AiService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, AI_PROXY_URL: 'https://ai-proxy.example.com', AI_API_KEY: 'test-key' };
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    service = new AiService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it('returns the extracted items on a well-formed response', async () => {
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [{ text: 'Onboard the new member', suggested_owner_role: 'chair' }] })));

    const result = await service.extractBriefActionItems(req, { brief_text: 'The committee discussed onboarding.' });

    expect(result.items).toEqual([{ text: 'Onboard the new member', suggested_owner_role: 'chair' }]);
  });

  it('returns an empty items array for a genuinely quiet week', async () => {
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [] })));

    const result = await service.extractBriefActionItems(req, { brief_text: 'Nothing notable happened this week.' });

    expect(result.items).toEqual([]);
  });

  it('truncates to WEEKLY_BRIEF_ACTION_ITEMS_MAX even if the model returns more', async () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ text: `Item ${i}` }));
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items })));

    const result = await service.extractBriefActionItems(req, { brief_text: 'brief' });

    expect(result.items).toHaveLength(5);
  });

  it('clamps an over-length text/suggested_owner_role instead of trusting the schema maxLength hint', async () => {
    const longText = 'x'.repeat(400);
    const longRole = 'y'.repeat(150);
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [{ text: longText, suggested_owner_role: longRole }] })));

    const result = await service.extractBriefActionItems(req, { brief_text: 'brief' });

    expect(result.items[0].text).toHaveLength(300);
    expect(result.items[0].suggested_owner_role).toHaveLength(100);
  });

  it('drops malformed items (missing/non-string text) instead of throwing', async () => {
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [{ text: 'Valid item' }, { suggested_owner_role: 'no text field' }, null, 42] })));

    const result = await service.extractBriefActionItems(req, { brief_text: 'brief' });

    expect(result.items).toEqual([{ text: 'Valid item', suggested_owner_role: undefined }]);
  });

  it('throws when AI_PROXY_URL/AI_API_KEY are unset (isAiConfigured() false) — never calls fetch', async () => {
    process.env['AI_PROXY_URL'] = '';
    process.env['AI_API_KEY'] = '';
    service = new AiService();

    await expect(service.extractBriefActionItems(req, { brief_text: 'brief' })).rejects.toThrow(/AI service not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the AI proxy responds with a non-2xx status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'boom' } as unknown as Response);

    await expect(service.extractBriefActionItems(req, { brief_text: 'brief' })).rejects.toThrow(/Failed to extract brief action items/);
  });

  it('bounds the fetch with an AbortSignal timeout, not an unbounded request', async () => {
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [] })));

    await service.extractBriefActionItems(req, { brief_text: 'brief' });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not log at ERROR on failure — the only caller (WeeklyBriefService) always degrades and logs WARN itself', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'boom' } as unknown as Response);

    await expect(service.extractBriefActionItems(req, { brief_text: 'brief' })).rejects.toThrow();

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('throws when the response body is not a valid items array', async () => {
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: 'not an array' })));

    await expect(service.extractBriefActionItems(req, { brief_text: 'brief' })).rejects.toThrow(/Failed to extract brief action items/);
  });
});

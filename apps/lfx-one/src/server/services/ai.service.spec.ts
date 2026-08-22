// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config — a real, unmocked
// import re-triggers the Angular JIT-compilation failure (matches weekly-brief.service.spec.ts's
// convention). Most values below are inert mock strings/numbers this file's assertions don't
// depend on being "real" — except AI_REQUEST_CONFIG and MEETING_AGENDA_MAX_LENGTH, which the
// timeout-split and agenda-clamping tests below assert against directly. Those two are pulled from
// their real files via direct relative imports inside this async factory (bypassing the
// '@lfx-one/shared/constants' alias, which resolves to the barrel — all constants files, including
// ones with the Angular-tainted transitive imports this mock exists to avoid; the two direct files
// only pull in their own plain sibling imports), so the mock structurally cannot drift from the
// values AiService actually uses in production.
vi.mock('@lfx-one/shared/constants', async () => {
  const actual = await import('../../../../../packages/shared/src/constants/ai.constants');
  const meeting = await import('../../../../../packages/shared/src/constants/meeting.constants');
  return {
    AI_AGENDA_SYSTEM_PROMPT: 'agenda prompt',
    AI_BRIEF_ACTION_ITEMS_SYSTEM_PROMPT: 'brief action items prompt',
    AI_MODEL: 'mock-model',
    AI_NEWSLETTER_SYSTEM_PROMPT: 'newsletter prompt',
    AI_REQUEST_CONFIG: actual.AI_REQUEST_CONFIG,
    DURATION_ESTIMATION: { BASE_DURATION: 15, TIME_PER_ITEM: 10, MINIMUM_DURATION: 30, MAXIMUM_DURATION: 240 },
    // Pulled from the real file for the same reason as AI_REQUEST_CONFIG: the cap is asserted against
    // directly below, so a hand-copied literal could drift from the value AiService actually clamps to.
    MEETING_AGENDA_MAX_LENGTH: meeting.MEETING_AGENDA_MAX_LENGTH,
    NEWSLETTER_AI_MAX_TOKENS: 12_000,
    WEEKLY_BRIEF_ACTION_ITEM_OWNER_ROLE_MAX_LENGTH: 100,
    WEEKLY_BRIEF_ACTION_ITEM_TEXT_MAX_LENGTH: 300,
    WEEKLY_BRIEF_ACTION_ITEMS_MAX: 5,
  };
});
vi.mock('@lfx-one/shared/enums', () => ({
  MeetingType: { BOARD: 'board', MAINTAINERS: 'maintainers', MARKETING: 'marketing', TECHNICAL: 'technical', LEGAL: 'legal', OTHER: 'other', NONE: 'none' },
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
// Real implementation, not a stub: the clamping tests below assert on the agenda string the service
// returns, so a stubbed truncator would test the stub. `string.utils` imports nothing of its own.
vi.mock('@lfx-one/shared/utils', async () => ({
  truncateToUtf16Units: (await import('../../../../../packages/shared/src/utils/string.utils')).truncateToUtf16Units,
}));

import { AI_REQUEST_CONFIG } from '@lfx-one/shared/constants';
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
    vi.restoreAllMocks(); // un-spies AbortSignal.timeout even if a test fails before its own mockRestore()
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

  it('drops whitespace-only text instead of caching a blank row (PR #1362 review)', async () => {
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [{ text: '   ' }, { text: '\n\t' }, { text: 'Real item' }] })));

    const result = await service.extractBriefActionItems(req, { brief_text: 'brief' });

    expect(result.items).toEqual([{ text: 'Real item', suggested_owner_role: undefined }]);
  });

  it('normalizes a null suggested_owner_role (the strict-schema-required shape) to undefined', async () => {
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [{ text: 'Item with no inferable owner', suggested_owner_role: null }] })));

    const result = await service.extractBriefActionItems(req, { brief_text: 'brief' });

    expect(result.items).toEqual([{ text: 'Item with no inferable owner', suggested_owner_role: undefined }]);
  });

  it('sends a schema where every property in the items schema is also in required (strict-mode requirement, PR #1362 review)', async () => {
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [] })));

    await service.extractBriefActionItems(req, { brief_text: 'brief' });

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    const itemSchema = body.response_format.json_schema.schema.properties.items.items;
    expect(itemSchema.required).toEqual(expect.arrayContaining(Object.keys(itemSchema.properties)));
    expect(itemSchema.properties.suggested_owner_role.type).toEqual(['string', 'null']);
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

  it('preserves the original failure cause in the thrown error message instead of discarding it (PR #1362 review — Cursor Bugbot)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => '{"error":"Invalid API key"}' } as unknown as Response);

    await expect(service.extractBriefActionItems(req, { brief_text: 'brief' })).rejects.toThrow(/401 Unauthorized.*Invalid API key/);
  });

  it('bounds the fetch with an AbortSignal timeout, not an unbounded request', async () => {
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [] })));

    await service.extractBriefActionItems(req, { brief_text: 'brief' });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the tighter EXTRACTION_TIMEOUT_MS, not the generous default TIMEOUT_MS used by the POST-driven generators', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ items: [] })));

    await service.extractBriefActionItems(req, { brief_text: 'brief' });

    // Asserts against the real constant (the mock factory imports it directly — see the
    // vi.mock('@lfx-one/shared/constants', ...) comment above), not a value duplicated in this
    // file, so this can't pass while silently testing a stale bound.
    expect(timeoutSpy).toHaveBeenCalledWith(AI_REQUEST_CONFIG.EXTRACTION_TIMEOUT_MS);
  });

  it('sanity: EXTRACTION_TIMEOUT_MS is actually tighter than TIMEOUT_MS, not just differently named', () => {
    // The two tests above verify the right constant reaches the right call site, but since the
    // mock IS the real constant (not a duplicated value), they'd both stay green even if someone
    // misconfigured EXTRACTION_TIMEOUT_MS to be >= TIMEOUT_MS — the split would be pointless but
    // "correctly" wired. This is the one invariant worth checking independently of the mock.
    expect(AI_REQUEST_CONFIG.EXTRACTION_TIMEOUT_MS).toBeLessThan(AI_REQUEST_CONFIG.TIMEOUT_MS);
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

describe('AiService.generateMeetingAgenda', () => {
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
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('gets the generous default timeout, not the tight extraction bound (LFXV2-3043)', async () => {
    const { MeetingType } = await import('@lfx-one/shared/enums');
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ agenda: 'agenda text', duration: 30 })));

    await service.generateMeetingAgenda(req, { meetingType: MeetingType.MAINTAINERS, title: 'Sanity check', projectName: 'Debug Project' });

    expect(timeoutSpy).toHaveBeenCalledWith(AI_REQUEST_CONFIG.TIMEOUT_MS);
  });

  // GH-1464: the helper is reachable before Details & Access is filled in, so `buildPrompt` has to
  // omit each absent descriptor rather than emit an "undefined" clause the model would read as text.
  describe('prompt shape with partial descriptors', () => {
    async function promptFor(request: Parameters<AiService['generateMeetingAgenda']>[1]): Promise<string> {
      fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ agenda: 'agenda text', duration: 30 })));

      await service.generateMeetingAgenda(req, request);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      return body.messages.find((message: { role: string }) => message.role === 'user').content;
    }

    it('omits the title and project clauses when only a goal is supplied', async () => {
      const prompt = await promptFor({ context: 'Plan the Q3 release' });

      expect(prompt).toContain('Additional context: Plan the Q3 release');
      expect(prompt).not.toContain('titled');
      // The project clause reads `for the <name> project` — the type fallback also says "project".
      expect(prompt).not.toContain('for the ');
      expect(prompt).not.toContain('undefined');
    });

    it('omits the context clause when only a title is supplied', async () => {
      const prompt = await promptFor({ title: 'TAC Monthly' });

      expect(prompt).toContain('titled "TAC Monthly"');
      expect(prompt).not.toContain('Additional context');
      expect(prompt).not.toContain('undefined');
    });

    it('describes a project team meeting when no meeting type is chosen', async () => {
      const prompt = await promptFor({ title: 'TAC Monthly' });

      expect(prompt).toContain('for a project team meeting');
    });

    it('states the character cap in both the prompt and the response schema', async () => {
      const prompt = await promptFor({ title: 'TAC Monthly', maxCharacters: 1200 });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);

      expect(prompt).toContain('must not exceed 1200 characters');
      expect(body.response_format.json_schema.schema.properties.agenda.maxLength).toBe(1200);
    });

    // The prompt used to read the raw request while the schema and the outbound clamp read the resolved
    // cap, so the three could disagree — the model was told "-5 characters" while the schema advertised
    // something else. Both non-positive and absent caps resolve to the default, matching the policy
    // `resolveAgendaMaxCharacters` states at the HTTP boundary.
    it.each([
      ['no cap', undefined],
      ['a zero cap', 0],
      ['a negative cap', -5],
    ])('resolves %s to the default in both the prompt and the schema', async (_label, maxCharacters) => {
      const { MEETING_AGENDA_MAX_LENGTH } = await import('@lfx-one/shared/constants');
      const prompt = await promptFor({ title: 'TAC Monthly', maxCharacters });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);

      expect(prompt).toContain(`must not exceed ${MEETING_AGENDA_MAX_LENGTH} characters`);
      expect(body.response_format.json_schema.schema.properties.agenda.maxLength).toBe(MEETING_AGENDA_MAX_LENGTH);
    });
  });

  // The schema's `maxLength` and the prompt's cap are both hints the model can ignore. The composer
  // writes the returned agenda into a control carrying `Validators.maxLength(MEETING_AGENDA_MAX_LENGTH)`
  // programmatically — past the textarea's native cap — so an over-cap agenda would leave the whole
  // form invalid and Save silently inert. Hence the clamp on the way out.
  describe('agenda length clamping', () => {
    it('clamps an over-cap agenda from the JSON path', async () => {
      fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ agenda: 'x'.repeat(1500), duration: 30 })));

      const result = await service.generateMeetingAgenda(req, { title: 'TAC Monthly', maxCharacters: 1200 });

      expect(result.agenda).toHaveLength(1200);
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'generate_meeting_agenda',
        expect.stringContaining('truncating'),
        expect.objectContaining({ source: 'json' })
      );
    });

    it('clamps an over-cap agenda from the plain-text fallback path', async () => {
      fetchMock.mockResolvedValue(mockChatResponse('y'.repeat(1500)));

      const result = await service.generateMeetingAgenda(req, { title: 'TAC Monthly', maxCharacters: 1200 });

      expect(result.agenda).toHaveLength(1200);
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'generate_meeting_agenda',
        expect.stringContaining('truncating'),
        expect.objectContaining({ source: 'text_fallback' })
      );
    });

    it('leaves an agenda within the cap untouched and logs nothing', async () => {
      fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ agenda: 'Roll call', duration: 30 })));

      const result = await service.generateMeetingAgenda(req, { title: 'TAC Monthly', maxCharacters: 1200 });

      expect(result.agenda).toBe('Roll call');
      expect(logger.warning).not.toHaveBeenCalled();
    });

    it('falls back to MEETING_AGENDA_MAX_LENGTH when the caller supplies no cap', async () => {
      const { MEETING_AGENDA_MAX_LENGTH } = await import('@lfx-one/shared/constants');
      fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ agenda: 'z'.repeat(MEETING_AGENDA_MAX_LENGTH + 500), duration: 30 })));

      const result = await service.generateMeetingAgenda(req, { title: 'TAC Monthly' });

      expect(result.agenda).toHaveLength(MEETING_AGENDA_MAX_LENGTH);
    });
  });
});

describe('AiService.generateNewsletter', () => {
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
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('gets its own NEWSLETTER_TIMEOUT_MS, not the generic default shared with agenda generation', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(mockChatResponse(JSON.stringify({ subject: 'Subject', bodyHtml: '<p>Body</p>' })));

    await service.generateNewsletter(req, { rawContent: 'notes', contextType: 'project', contextName: 'Debug Project' });

    expect(timeoutSpy).toHaveBeenCalledWith(AI_REQUEST_CONFIG.NEWSLETTER_TIMEOUT_MS);
    expect(AI_REQUEST_CONFIG.NEWSLETTER_TIMEOUT_MS).toBeGreaterThan(AI_REQUEST_CONFIG.TIMEOUT_MS);
  });
});

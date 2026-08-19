// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { BRAND_KIT_INTAKE, MKTG_RUN_POLL, MKTG_RUN_STORAGE_KEY_PREFIX } from '@lfx-one/shared/constants';
import { MktgGenerateProgress, MktgGenerateRequest, MktgRunResultResponse, MktgStoredAgentRun } from '@lfx-one/shared/interfaces';
import { renderMktgIntakeMessage } from '@lfx-one/shared/utils';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgAgentRunService } from './mktg-agent-run.service';

/**
 * Locks the run flow to the real BFF contract: the validated generate/result
 * endpoint pair is always POSTed with the owner token in the BODY (never a GET,
 * never a query string), regenerations ride the chat/session contract on the
 * stored session, and only a `ready` result with a strictly newer envelope
 * version is accepted as the document — a stale prior draft or `pending` poll
 * must never be stored as a new version.
 */
describe('MktgAgentRunService', () => {
  const STORAGE_KEY = `${MKTG_RUN_STORAGE_KEY_PREFIX}:proj-1:brand-kit`;
  const ANSWERS: Record<string, string> = Object.fromEntries(BRAND_KIT_INTAKE.fields.map((field) => [field.key, `Answer for ${field.key}`]));

  let service: MktgAgentRunService;
  let httpPost: ReturnType<typeof vi.fn>;
  /** Result-endpoint responses, consumed one per poll (last one repeats). */
  let resultResponses: MktgRunResultResponse[];

  const generateRequest = (feedback?: string, priorVersion?: number): MktgGenerateRequest => ({
    agentId: 'brand-kit',
    projectUid: 'proj-1',
    intake: BRAND_KIT_INTAKE,
    answers: ANSWERS,
    feedback,
    priorVersion,
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    resultResponses = [];
    httpPost = vi.fn((url: string) => {
      if (url === BRAND_KIT_INTAKE.endpoints.generate) {
        return of({ sessionId: 'sess-1', ownerToken: 'token-1' });
      }
      if (url === '/api/mktg-agents/chat') {
        return of({ success: true });
      }
      if (url === BRAND_KIT_INTAKE.endpoints.result) {
        const next = resultResponses.length > 1 ? resultResponses.shift() : resultResponses[0];
        return of(next ?? { status: 'pending' });
      }
      throw new Error(`Unexpected POST to ${url}`);
    });
    TestBed.configureTestingModule({
      // Only `post` exists on the mock — any GET (the bug this spec guards
      // against) or other verb fails loudly instead of silently passing.
      providers: [{ provide: HttpClient, useValue: { post: httpPost } }],
    });
    service = TestBed.inject(MktgAgentRunService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a first run via POST to the validated generate endpoint with the full answers', async () => {
    resultResponses = [{ status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];
    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    expect(httpPost).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.generate, { answers: ANSWERS });
    expect(events).toEqual([{ type: 'submitted' }]);

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);

    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('document');
  });

  it('polls the result endpoint via POST with sessionId AND ownerToken in the body — never the query string', async () => {
    resultResponses = [{ status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];
    service.generate(generateRequest()).subscribe();

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);

    expect(httpPost).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.result, { sessionId: 'sess-1', ownerToken: 'token-1' });
  });

  it('keeps polling through pending results and stores the ready document with its envelope version', async () => {
    resultResponses = [{ status: 'pending' }, { status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];
    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(events).toEqual([{ type: 'submitted' }]);

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(events).toHaveLength(2);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
    expect(stored.versions).toHaveLength(1);
    expect(stored.versions[0]).toMatchObject({ version: 1, document: '# Brand Kit' });
    expect(stored).toMatchObject({ sessionId: 'sess-1', ownerToken: 'token-1', answers: ANSWERS });
  });

  it('regenerates as a chat follow-up on the stored session (full form + feedback + prior_version) and rejects the stale prior draft', async () => {
    const priorRun: MktgStoredAgentRun = {
      agentId: 'brand-kit',
      projectUid: 'proj-1',
      sessionId: 'sess-1',
      ownerToken: 'token-1',
      answers: ANSWERS,
      versions: [{ version: 1, document: '# v1', createdAt: '2026-08-19T00:00:00.000Z' }],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(priorRun));
    // The session's prior envelope is still `ready` at v1 — only v2 may count.
    resultResponses = [
      { status: 'ready', documentMarkdown: '# v1', version: 1 },
      { status: 'ready', documentMarkdown: '# v2', version: 2 },
    ];

    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest('Tighten the taglines.', 1)).subscribe((event) => events.push(event));

    expect(httpPost).toHaveBeenCalledWith('/api/mktg-agents/chat', {
      agentId: 'brand-kit',
      message: renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS, 'Tighten the taglines.', 1),
      sessionId: 'sess-1',
      ownerToken: 'token-1',
    });

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    // Stale v1 poll response — still no document event.
    expect(events).toEqual([{ type: 'submitted' }]);

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(events).toHaveLength(2);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
    expect(stored.versions).toHaveLength(2);
    expect(stored.versions[1]).toMatchObject({ version: 2, document: '# v2', feedback: 'Tighten the taglines.' });
  });
});

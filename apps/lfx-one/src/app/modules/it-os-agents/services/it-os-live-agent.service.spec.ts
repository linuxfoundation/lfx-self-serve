// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IT_OS_LIVE_MAX_WAIT_MS, IT_OS_LIVE_POLL_MS } from '@lfx-one/shared/constants';
import { MktgChatMessage } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItOsLiveAgentService } from './it-os-live-agent.service';

describe('ItOsLiveAgentService', () => {
  let service: ItOsLiveAgentService;
  let http: HttpTestingController;

  const PROJECT = 'project-uid-1';
  const user = (id: string, text: string): MktgChatMessage => ({ id, sender: 'user', text, timestamp: '17:00' });
  const agent = (id: string, text: string): MktgChatMessage => ({ id, sender: 'agent', text, timestamp: '17:00' });
  /** Moves to the next poll and answers it. */
  const answerHistory = (messages: MktgChatMessage[], turnComplete: boolean): void => {
    vi.advanceTimersByTime(IT_OS_LIVE_POLL_MS);
    http.expectOne('/api/it-os-agents/history').flush({ messages, turnComplete });
  };
  const start = (): void => {
    service.send('domains', PROJECT, 'hi');
    http.expectOne('/api/it-os-agents/chat').flush({ sessionId: 's1', ownerToken: 't1' });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [ItOsLiveAgentService, provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ItOsLiveAgentService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('starts a session with the project uid and stops once the turn is complete', () => {
    service.send('domains', PROJECT, 'What domains do we have?');
    const request = http.expectOne('/api/it-os-agents/chat');
    expect(request.request.body).toEqual({ agentId: 'domains', project: PROJECT, message: 'What domains do we have?' });
    request.flush({ sessionId: 's1', ownerToken: 't1' });

    answerHistory([user('e1', 'What domains do we have?'), agent('e2', 'hurrdurr.org')], true);

    expect(service.waiting()).toBe(false);
    expect(service.messages().map((m) => m.text)).toEqual(['What domains do we have?', 'hurrdurr.org']);
  });

  it('keeps polling past interim messages until the turn is complete', () => {
    start();
    const interim = [user('e1', 'hi'), agent('e2', 'Checking the records…')];
    answerHistory(interim, false);
    answerHistory(interim, false);
    expect(service.waiting()).toBe(true);

    answerHistory([...interim, agent('e3', 'Want me to go ahead?')], true);

    expect(service.waiting()).toBe(false);
    expect(service.messages()).toHaveLength(3);
  });

  it('waits for a slow history call instead of cancelling it', () => {
    start();
    vi.advanceTimersByTime(IT_OS_LIVE_POLL_MS);
    const slow = http.expectOne('/api/it-os-agents/history');
    vi.advanceTimersByTime(IT_OS_LIVE_POLL_MS * 2);
    http.expectNone('/api/it-os-agents/history');

    expect(slow.cancelled).toBe(false);
    slow.flush({ messages: [user('e1', 'hi'), agent('e2', 'hello')], turnComplete: true });
    expect(service.waiting()).toBe(false);
  });

  it('skips a poll that fails transiently and carries on', () => {
    start();
    vi.advanceTimersByTime(IT_OS_LIVE_POLL_MS);
    http.expectOne('/api/it-os-agents/history').flush({}, { status: 502, statusText: 'Bad Gateway' });
    expect(service.waiting()).toBe(true);

    answerHistory([user('e1', 'hi'), agent('e2', 'hello')], true);
    expect(service.waiting()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('sends follow-ups on the same session with its owner token', () => {
    start();
    answerHistory([user('e1', 'hi'), agent('e2', 'hello')], true);

    service.send('domains', PROJECT, 'Yes, go ahead.');
    const followUp = http.expectOne('/api/it-os-agents/chat');
    expect(followUp.request.body).toEqual({ agentId: 'domains', project: PROJECT, message: 'Yes, go ahead.', sessionId: 's1', ownerToken: 't1' });
    followUp.flush({ success: true });
    // The previous turn still reads as complete until Guild records the new message; no new reply yet, so keep waiting.
    answerHistory([user('e1', 'hi'), agent('e2', 'hello')], true);
    expect(service.waiting()).toBe(true);
    answerHistory([user('e1', 'hi'), agent('e2', 'hello'), user('e3', 'Yes, go ahead.'), agent('e4', 'Done.')], true);

    expect(service.waiting()).toBe(false);
  });

  it('explains a refused request and stops waiting', () => {
    service.send('domains', PROJECT, 'hi');
    http.expectOne('/api/it-os-agents/chat').flush({}, { status: 403, statusText: 'Forbidden' });

    expect(service.waiting()).toBe(false);
    expect(service.error()).toBe('You need write access to this project to use the live agent.');
  });

  it('gives up after the longest wait without a finished turn', () => {
    start();
    for (let waited = IT_OS_LIVE_POLL_MS; waited < IT_OS_LIVE_MAX_WAIT_MS; waited += IT_OS_LIVE_POLL_MS) answerHistory([user('e1', 'hi')], false);
    vi.advanceTimersByTime(IT_OS_LIVE_POLL_MS);

    expect(service.waiting()).toBe(false);
    expect(service.error()).toContain('taking longer than usual');
  });
});

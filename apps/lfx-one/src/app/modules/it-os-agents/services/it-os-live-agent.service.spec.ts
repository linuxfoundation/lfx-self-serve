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
  const answerHistory = (messages: MktgChatMessage[]): void => {
    vi.advanceTimersByTime(IT_OS_LIVE_POLL_MS);
    http.expectOne('/api/it-os-agents/history').flush({ messages });
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

  it('starts a session, then polls until the agent has replied and the history stops growing', () => {
    service.send('domains', PROJECT, 'What domains do we have?');
    const start = http.expectOne('/api/it-os-agents/chat');
    expect(start.request.body).toEqual({ agentId: 'domains', project: PROJECT, message: 'What domains do we have?' });
    start.flush({ sessionId: 's1', ownerToken: 't1' });

    expect(service.waiting()).toBe(true);
    answerHistory([user('e1', 'What domains do we have?')]);
    answerHistory([user('e1', 'What domains do we have?'), agent('e2', 'hurrdurr.org')]);
    expect(service.waiting()).toBe(true);
    answerHistory([user('e1', 'What domains do we have?'), agent('e2', 'hurrdurr.org')]);

    expect(service.waiting()).toBe(false);
    expect(service.messages().map((m) => m.text)).toEqual(['What domains do we have?', 'hurrdurr.org']);
  });

  it('sends follow-ups on the same session with its owner token', () => {
    service.send('domains', PROJECT, 'hi');
    http.expectOne('/api/it-os-agents/chat').flush({ sessionId: 's1', ownerToken: 't1' });
    answerHistory([user('e1', 'hi'), agent('e2', 'hello')]);
    answerHistory([user('e1', 'hi'), agent('e2', 'hello')]);

    service.send('domains', PROJECT, 'Yes, go ahead.');
    const followUp = http.expectOne('/api/it-os-agents/chat');
    expect(followUp.request.body).toEqual({ agentId: 'domains', project: PROJECT, message: 'Yes, go ahead.', sessionId: 's1', ownerToken: 't1' });
    followUp.flush({ success: true });
    answerHistory([user('e1', 'hi'), agent('e2', 'hello'), user('e3', 'Yes, go ahead.'), agent('e4', 'Done.')]);
    answerHistory([user('e1', 'hi'), agent('e2', 'hello'), user('e3', 'Yes, go ahead.'), agent('e4', 'Done.')]);

    expect(service.waiting()).toBe(false);
  });

  it('explains a refused request and stops waiting', () => {
    service.send('domains', PROJECT, 'hi');
    http.expectOne('/api/it-os-agents/chat').flush({}, { status: 403, statusText: 'Forbidden' });

    expect(service.waiting()).toBe(false);
    expect(service.error()).toBe('You need write access to this project to use the live agent.');
  });

  it('gives up after the longest wait without a reply', () => {
    service.send('domains', PROJECT, 'hi');
    http.expectOne('/api/it-os-agents/chat').flush({ sessionId: 's1', ownerToken: 't1' });
    for (let waited = 0; waited < IT_OS_LIVE_MAX_WAIT_MS; waited += IT_OS_LIVE_POLL_MS) answerHistory([user('e1', 'hi')]);

    expect(service.waiting()).toBe(false);
    expect(service.error()).toContain('taking longer than usual');
  });
});

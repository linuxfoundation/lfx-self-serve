// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_ANSWER_MEMORY_KEY_PREFIX, MKTG_ANSWER_MEMORY_MAX_VALUE_CHARS, MKTG_ANSWER_MEMORY_TTL_MS } from '@lfx-one/shared/constants';
import { MktgAnswerMemory, User } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { MktgAnswerMemoryService } from './mktg-answer-memory.service';

/**
 * The memory that stops one agent's intake from re-asking what the user typed
 * into another's. Its whole value is being trustworthy about WHOSE answer it
 * is and WHICH project it belongs to — a leak across either boundary would put
 * someone else's words in a form and label them the user's own — so the
 * scoping, the TTL prune, and the size cap are what this locks down.
 */
describe('MktgAnswerMemoryService', () => {
  const USER_SUB = 'auth0|user-1';
  const key = (userSub: string, projectUid: string): string => `${MKTG_ANSWER_MEMORY_KEY_PREFIX}:${userSub}:${projectUid}`;

  let service: MktgAnswerMemoryService;
  let userSignal: WritableSignal<User | null>;

  const configure = (platformId: 'browser' | 'server' = 'browser'): void => {
    window.localStorage.clear();
    userSignal = signal<User | null>({ sub: USER_SUB } as User);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: UserService, useValue: { user: userSignal } },
      ],
    });
    service = TestBed.inject(MktgAnswerMemoryService);
  };

  const stored = (projectUid: string): MktgAnswerMemory => JSON.parse(window.localStorage.getItem(key(USER_SUB, projectUid)) ?? '{}') as MktgAnswerMemory;

  beforeEach(() => configure());

  it('remembers submitted answers with the agent that collected them', () => {
    service.remember('proj-1', 'brand-kit', { github_url: 'https://github.com/example-org/example-repo', project_name: 'TestOrbit' });

    expect(service.load('proj-1')).toMatchObject({
      github_url: { value: 'https://github.com/example-org/example-repo', agentId: 'brand-kit' },
      project_name: { value: 'TestOrbit', agentId: 'brand-kit' },
    });
  });

  it('merges later runs over earlier ones per field, keeping untouched fields', () => {
    service.remember('proj-1', 'brand-kit', { github_url: 'https://github.com/example-org/old', project_name: 'TestOrbit' });
    service.remember('proj-1', 'foundation-setup', { github_url: 'https://github.com/example-org/new' });

    expect(service.load('proj-1')).toMatchObject({
      github_url: { value: 'https://github.com/example-org/new', agentId: 'foundation-setup' },
      project_name: { value: 'TestOrbit', agentId: 'brand-kit' },
    });
  });

  it('never mixes projects, and never surfaces another user’s answers', () => {
    service.remember('proj-1', 'brand-kit', { github_url: 'https://github.com/example-org/one' });

    expect(service.load('proj-2')).toEqual({});

    // A different effective user (login or Admin Mode impersonation) reads its own key.
    userSignal.set({ sub: 'auth0|user-2' } as User);
    expect(service.load('proj-1')).toEqual({});
    expect(stored('proj-1')['github_url'].value).toBe('https://github.com/example-org/one');
  });

  it('skips blank answers and anything longer than the value cap', () => {
    service.remember('proj-1', 'brand-kit', {
      github_url: '   ',
      project_name: '  TestOrbit  ',
      gap_fill_notes: 'x'.repeat(MKTG_ANSWER_MEMORY_MAX_VALUE_CHARS + 1),
    });

    const memory = service.load('proj-1');
    expect(memory['github_url']).toBeUndefined();
    expect(memory['gap_fill_notes']).toBeUndefined();
    expect(memory['project_name'].value).toBe('TestOrbit');
  });

  it('prunes entries past the TTL on read and rewrites what is left', () => {
    const expired = new Date(Date.now() - MKTG_ANSWER_MEMORY_TTL_MS - 1000).toISOString();
    window.localStorage.setItem(
      key(USER_SUB, 'proj-1'),
      JSON.stringify({
        github_url: { value: 'https://github.com/example-org/stale', agentId: 'brand-kit', savedAt: expired },
        project_name: { value: 'TestOrbit', agentId: 'brand-kit', savedAt: new Date().toISOString() },
      })
    );

    const memory = service.load('proj-1');

    expect(memory['github_url']).toBeUndefined();
    expect(memory['project_name'].value).toBe('TestOrbit');
    expect(stored('proj-1')['github_url']).toBeUndefined();
  });

  it('treats a record with an unreadable savedAt as expired rather than trusting it forever', () => {
    window.localStorage.setItem(key(USER_SUB, 'proj-1'), JSON.stringify({ github_url: { value: 'https://github.com/x/y', agentId: 'brand-kit' } }));

    expect(service.load('proj-1')).toEqual({});
  });

  it('survives corrupt storage instead of throwing into the form', () => {
    window.localStorage.setItem(key(USER_SUB, 'proj-1'), 'not json');
    expect(service.load('proj-1')).toEqual({});
  });

  it('is inert without an authenticated user or a project — a remembered answer needs an owner and a scope', () => {
    userSignal.set(null);
    service.remember('proj-1', 'brand-kit', { github_url: 'https://github.com/example-org/one' });
    expect(window.localStorage.length).toBe(0);
    expect(service.load('proj-1')).toEqual({});

    userSignal.set({ sub: USER_SUB } as User);
    service.remember('', 'brand-kit', { github_url: 'https://github.com/example-org/one' });
    expect(window.localStorage.length).toBe(0);
  });

  it('never touches storage on the server (SSR)', () => {
    configure('server');

    service.remember('proj-1', 'brand-kit', { github_url: 'https://github.com/example-org/one' });

    expect(service.load('proj-1')).toEqual({});
    expect(window.localStorage.length).toBe(0);
  });
});

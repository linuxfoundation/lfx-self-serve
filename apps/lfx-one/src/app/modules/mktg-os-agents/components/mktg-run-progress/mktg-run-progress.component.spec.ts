// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MKTG_DOCUMENT_TYPES, MKTG_RUN_POLL, MKTG_RUN_ANSWERED } from '@lfx-one/shared/constants';
import { MktgDocumentDetailResponse, MktgDocumentRunProgress, MktgRevisionSummary, MktgRevisionResponse, User } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgRunAnswersService } from '@services/mktg-run-answers.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { UserService } from '@services/user.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MktgRunProgressComponent } from './mktg-run-progress.component';

describe('MktgRunProgressComponent', () => {
  const runId = 'c'.repeat(64);
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'living' && entry.agentKey === 'foundation-message');
  if (!type) throw new Error('Missing living fixture type');
  const run: MktgDocumentRunProgress = {
    project: 'synthetic-project',
    agentKey: type.agentKey,
    documentId: 'living',
    runId,
    state: 'writing',
    startedAt: '2026-10-28T10:00:00Z',
  };
  const detail = (runs: MktgDocumentRunProgress[] = [run]): MktgDocumentDetailResponse => ({
    project: run.project,
    type,
    documentId: run.documentId,
    revisions: [],
    approvedCurrent: null,
    runs,
  });
  let fixture: ComponentFixture<MktgRunProgressComponent>;
  const user = signal<User | null>({ sub: 'synthetic-creator' } as User);
  const read = vi.fn();
  const revisionRead = vi.fn();
  const answer = vi.fn();
  const loadAttempt = vi.fn();
  const waiting = {
    ...run,
    state: 'questions' as const,
    pendingQuestions: {
      questionsId: 'd'.repeat(64),
      askedAt: run.startedAt,
      questions: [{ key: 'audience', label: 'Audience', question: 'Who is this for?', why: '', suggestedAnswer: 'Synthetic maintainers', basis: [] }],
    },
  };
  const setup = async (platform = 'browser') => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    read.mockReset().mockReturnValue(of(detail()));
    revisionRead.mockReset();
    answer.mockReset().mockReturnValue(of({ runId, state: 'writing' }));
    loadAttempt.mockReset().mockReturnValue(null);
    user.set({ sub: 'synthetic-creator' } as User);
    await TestBed.configureTestingModule({
      imports: [MktgRunProgressComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: UserService, useValue: { user } },
        { provide: MktgDocumentStoreService, useValue: { getDocument: read, getRevision: revisionRead } },
        { provide: MktgRunAnswersService, useValue: { answer } },
        { provide: MktgRunAttemptService, useValue: { load: loadAttempt } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MktgRunProgressComponent);
    for (const [key, value] of Object.entries({ project: run.project, agentKey: run.agentKey, documentId: run.documentId, runId, runPage: true }))
      fixture.componentRef.setInput(key, value);
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it.each(['writing', 'storing', 'questions', 'failed'] as const)('renders %s with the original document card wording', async (state) => {
    await setup();
    fixture.componentRef.setInput('runPage', false);
    read.mockReturnValue(of(detail([{ ...run, state, failureText: state === 'failed' ? '<script>synthetic reply</script>' : undefined }])));
    await fixture.whenStable();
    const headings = { failed: "wasn't finished", questions: 'Waiting for your answers', writing: 'Generating the asset', storing: 'Generating the asset' };
    expect(text()).toContain(headings[state]);
    if (state === 'storing') expect(text()).toContain('Saving the revision');
    if (state === 'failed') {
      expect(text()).toContain('<script>synthetic reply</script>');
      expect(fixture.nativeElement.querySelector('script')).toBeNull();
    }
  });

  it('emits completion once for a selected stored run and never calls it writing', async () => {
    await setup();
    const landed = vi.fn();
    fixture.componentInstance.landed.subscribe(landed);
    read.mockReturnValue(of(detail([{ ...run, state: 'completed', producedRevisionId: '000009-' + '9'.repeat(64) }])));
    await fixture.whenStable();
    expect(landed).toHaveBeenCalledOnce();
    expect(text()).toContain('Written — confirming the produced revision');
    expect(text()).not.toContain('Writing…');
    await vi.advanceTimersByTimeAsync(2 * MKTG_RUN_POLL.intervalMs);
    expect(read).toHaveBeenCalledOnce();
    expect(answer).not.toHaveBeenCalled();
  });

  it('reads the completed run produced revision rather than approved current for a document observer', async () => {
    await setup();
    fixture.componentRef.setInput('loadRevision', true);
    const produced: MktgRevisionSummary = {
      id: '000009-' + '9'.repeat(64),
      number: 9,
      createdAt: run.startedAt,
      origin: 'generated',
      restoredFromNumber: null,
      intakeMode: 'form',
      status: '',
      contentSha256: '9'.repeat(64),
      format: 'markdown',
      commentCount: 0,
      latest: true,
      approval: null,
    };
    const old = { ...produced, id: '000001-' + '1'.repeat(64), number: 1, contentSha256: '1'.repeat(64), latest: false };
    const metadata: MktgDocumentDetailResponse = {
      ...detail([{ ...run, state: 'completed', producedRevisionId: produced.id }]),
      revisions: [produced, old],
      approvedCurrent: { revisionId: old.id, number: 1 },
      current: { revisionId: old.id, changedAt: run.startedAt, changedBy: null },
    };
    const view: MktgRevisionResponse = { ...metadata, revision: produced, markdown: '# Produced v9', sidecar: null, approval: null };
    read.mockReturnValue(of(metadata));
    revisionRead.mockReturnValue(of(view));
    await fixture.whenStable();
    expect(revisionRead).toHaveBeenCalledExactlyOnceWith(run.project, run.agentKey, run.documentId, produced.id, true);
  });

  it('changes body/metadata mode on the next poll without an immediate duplicate request', async () => {
    await setup();
    const row: MktgRevisionSummary = {
      id: '000001-' + '1'.repeat(64),
      number: 1,
      createdAt: run.startedAt,
      origin: 'generated',
      restoredFromNumber: null,
      intakeMode: 'form',
      status: '',
      contentSha256: '1'.repeat(64),
      format: 'markdown',
      commentCount: 0,
      latest: true,
      approval: null,
    };
    const metadata = { ...detail([]), revisions: [row] };
    read.mockReturnValue(of(metadata));
    revisionRead.mockReturnValue(of({ ...metadata, revision: row, markdown: '# Kept body', sidecar: null, approval: null }));
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('runId', '');
    fixture.componentRef.setInput('continuous', true);
    fixture.componentRef.setInput('loadRevision', true);
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(1);
    expect(revisionRead).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('loadRevision', false);
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(2);
    expect(revisionRead).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('loadRevision', true);
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(3);
    expect(revisionRead).toHaveBeenCalledTimes(2);
  });

  it('keeps a dedicated questions receiver out of the public-card answer controls', async () => {
    await setup();
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('answersSupported', false);
    read.mockReturnValue(of(detail([{ ...run, state: 'questions' }])));
    await fixture.whenStable();
    expect(text()).toContain('The agent is waiting for input.');
    expect(text()).toContain('this version of the page cannot answer yet');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-document-view-intake-link"]')).toBeNull();
  });

  it.each(MKTG_DOCUMENT_TYPES.filter((entry) => entry.kind === 'run'))(
    'renders $agentKey once from measured progress, with its creator feed in place of generic steps',
    async (oneOff) => {
      await setup();
      fixture.componentRef.setInput('runPage', false);
      fixture.componentRef.setInput('agentKey', oneOff.agentKey);
      fixture.componentRef.setInput('documentId', 'run-synthetic');
      const response = new Subject<MktgDocumentDetailResponse>();
      read.mockReturnValue(response);
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('h2')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity"]')).toBeNull();
      const record = {
        ...run,
        agentKey: oneOff.agentKey,
        documentId: 'run-synthetic',
        activity: [
          { id: 'synthetic-step', kind: 'checking' as const, label: 'Checking synthetic sources', status: 'running' as const, startedAt: run.startedAt },
        ],
      };
      const measured = { ...detail([record]), type: oneOff, documentId: record.documentId };
      response.next(measured);
      response.complete();
      await fixture.whenStable();
      const heading = fixture.nativeElement.querySelector('h2');
      const noun = oneOff.agentKey === 'linkedin-post' ? 'post' : 'report';
      expect(heading?.textContent).toBe(`${oneOff.agentName} is working on your ${noun}.`);
      expect(fixture.nativeElement.querySelectorAll('h2')).toHaveLength(1);
      expect(text()).toContain('Checking synthetic sources');
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-document-view-run-steps"]')).toBeNull();
      expect(text().match(/You can leave this page — the agent keeps working\./g)).toHaveLength(1);
      expect(text()).not.toContain('It will appear here when it is ready.');
      expect(text()).not.toContain('Writing…');
      const feed = fixture.nativeElement.querySelector('lfx-mktg-run-activity');
      read.mockReturnValue(of(measured));
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('h2')).toBe(heading);
      expect(fixture.nativeElement.querySelector('lfx-mktg-run-activity')).toBe(feed);
    }
  );

  it.each([true, false].flatMap((polling) => [undefined, []].map((activity) => ({ polling, activity }))))(
    'keeps fallback steps when one-off activity has no rows (polling=$polling, activity=$activity)',
    async ({ polling, activity }) => {
      await setup();
      const oneOff = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'run');
      if (!oneOff) throw new Error('Missing synthetic one-off type');
      fixture.componentRef.setInput('runPage', false);
      fixture.componentRef.setInput('agentKey', oneOff.agentKey);
      const snapshot = { ...detail([{ ...run, agentKey: oneOff.agentKey, activity }]), type: oneOff };
      fixture.componentRef.setInput('polling', polling);
      fixture.componentRef.setInput('snapshot', snapshot);
      fixture.componentRef.setInput('externalActivity', activity);
      read.mockReturnValue(of(snapshot));
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-document-view-run-steps"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('lfx-mktg-run-activity')).toBeNull();
      expect(text().match(/You can leave this page — the agent keeps working\./g)).toHaveLength(1);
      expect(text()).toContain('It will appear here when it is ready.');
      expect(text()).toContain('Writing…');
    }
  );

  it.each([false, true])('keeps one Member document heading and selects feed or fallback by rows (steps=%s)', async (hasSteps) => {
    await setup();
    const member = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'member-360');
    if (!member) throw new Error('Missing synthetic Member document type');
    const documentId = 'run-synthetic';
    const activity = hasSteps
      ? [{ id: 'synthetic-step', kind: 'lfx' as const, label: 'Checking LFX', status: 'running' as const, startedAt: run.startedAt }]
      : [];
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('polling', false);
    fixture.componentRef.setInput('agentKey', member.agentKey);
    fixture.componentRef.setInput('documentId', documentId);
    fixture.componentRef.setInput('snapshot', { ...detail([{ ...run, agentKey: member.agentKey, documentId, activity }]), type: member, documentId });
    fixture.componentRef.setInput('externalActivity', activity);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-title"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('h2')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('h2')?.textContent).toBe('Member 360 Agent is working on your report.');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-run-activity"]')).toHaveLength(hasSteps ? 1 : 0);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-document-view-run-steps"]')).toHaveLength(hasSteps ? 0 : 1);
    expect(text().match(/You can leave this page — the agent keeps working\./g)).toHaveLength(1);
    if (hasSteps) expect(text()).toContain('Checking LFX');
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['writing', 'storing'] as const)('keeps only the board leave line and feed for a legacy one-off snapshot (%s)', async (state) => {
    await setup();
    const oneOff = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'linkedin-post');
    if (!oneOff) throw new Error('Missing synthetic LinkedIn type');
    const activity = [
      { id: 'synthetic-step', kind: 'checking' as const, label: 'Checking synthetic sources', status: 'running' as const, startedAt: run.startedAt },
    ];
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('polling', false);
    fixture.componentRef.setInput('agentKey', oneOff.agentKey);
    fixture.componentRef.setInput('snapshot', { ...detail([{ ...run, agentKey: oneOff.agentKey, state }]), type: oneOff });
    fixture.componentRef.setInput('externalActivity', activity);
    await fixture.whenStable();
    expect(text().match(/You can leave this page — the agent keeps working\./g)).toHaveLength(1);
    expect(text()).not.toContain('It will appear here when it is ready.');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-document-view-run-steps"]')).toBeNull();
    expect(text()).toContain('Checking synthetic sources');
    expect(fixture.nativeElement.querySelectorAll('lfx-mktg-run-activity')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('h2')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('h2')?.textContent).toBe('LinkedIn Post Agent is working on your post.');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-activity-title"]')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('lets the document host own the announcement without hiding its progress card', async () => {
    await setup();
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('announceState', false);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-document-view-live-state"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-document-view-run"]')).not.toBeNull();
    fixture.componentRef.setInput('announceState', true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-document-view-live-state"]')).toHaveLength(1);
    expect(read).toHaveBeenCalledOnce();
  });

  it('keeps the document observer headless without rendering any live card or status', async () => {
    await setup();
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('headless', true);
    const observed = vi.fn();
    fixture.componentInstance.observed.subscribe(observed);
    await fixture.whenStable();
    expect(read).toHaveBeenCalledOnce();
    expect(observed).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('renders public questions with suggestions, sends once and resumes polling through current-document landing', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    await fixture.whenStable();
    expect(text()).toContain('A few questions before the draft');
    expect(fixture.nativeElement.querySelector('textarea').value).toBe('Synthetic maintainers');
    const response = new Subject<{ runId: string; state: 'writing' }>();
    answer.mockReturnValue(response);
    const send = fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button');
    send.click();
    send.click();
    expect(answer).toHaveBeenCalledExactlyOnceWith(
      runId,
      {
        project: run.project,
        questionsId: waiting.pendingQuestions.questionsId,
        answers: [{ key: 'audience', text: 'Synthetic maintainers', origin: 'accepted' }],
      },
      { agentKey: run.agentKey, documentId: run.documentId }
    );
    read.mockReturnValue(of(detail()));
    response.next({ runId, state: 'writing' });
    response.complete();
    await fixture.whenStable();
    expect(text()).not.toContain('A few questions before the draft');
    expect(fixture.componentInstance.runState()).toBe('writing');
    const landed = vi.fn();
    fixture.componentInstance.landed.subscribe(landed);
    const stored = detail([]);
    stored.revisions = [{ id: 'synthetic-stored', number: 1 } as MktgDocumentDetailResponse['revisions'][number]];
    read.mockReturnValue(of(stored));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(landed).toHaveBeenCalledOnce();
    expect(answer).toHaveBeenCalledOnce();
  });

  it('stops answer submission on 403, retaining the waiting notice and server reason without retries', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    answer.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'Synthetic access reason', code: 'FORBIDDEN' } })));
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button').click();
    await fixture.whenStable();
    expect(text()).toContain('Synthetic access reason');
    expect(text()).toContain('Waiting for your answers');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 3);
    expect(answer).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps an in-flight conflict response through a same-subject identity refresh', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    const response = new Subject<never>();
    answer.mockReturnValue(response);
    const announced = vi.fn();
    fixture.componentInstance.alreadyAnswered.subscribe(announced);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button').click();
    user.set({ sub: 'synthetic-creator' } as User);
    await fixture.whenStable();
    response.error(
      new HttpErrorResponse({
        status: 409,
        error: {
          code: MKTG_RUN_ANSWERED,
          details: { runId, questionsId: waiting.pendingQuestions.questionsId, answeredBy: 'Synthetic writer' },
        },
      })
    );
    await fixture.whenStable();
    expect(text()).toContain('Synthetic writer already answered these — the agent is writing.');
    expect(announced).toHaveBeenCalledWith({
      runId,
      questionsId: waiting.pendingQuestions.questionsId,
      message: 'Synthetic writer already answered these — the agent is writing.',
    });
    expect(answer).toHaveBeenCalledOnce();
  });

  it.each([
    { answeredBy: 'Synthetic writer', flattened: false, expected: 'Synthetic writer' },
    { answeredBy: null, flattened: true, expected: 'Someone on your team' },
    { answeredBy: '<script>synthetic</script>', flattened: false, expected: 'Someone on your team' },
    { answeredBy: 'synthetic-writer@example.test', flattened: true, expected: 'Someone on your team' },
    { answeredBy: 'auth0|synthetic-subject', flattened: false, expected: 'Someone on your team' },
  ])('moves an already-answered conflict to writing with attribution ($answeredBy)', async ({ answeredBy, flattened, expected }) => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    const details = { runId, questionsId: waiting.pendingQuestions.questionsId, answeredBy, answeredAt: run.startedAt };
    answer.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: MKTG_RUN_ANSWERED, ...(flattened ? details : { details }) } }))
    );
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button').click();
    await fixture.whenStable();
    expect(text()).toContain(`${expected} already answered these — the agent is writing.`);
    if (expected === 'Someone on your team' && answeredBy) expect(text()).not.toContain(answeredBy);
    expect(fixture.componentInstance.runState()).toBe('writing');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(read).toHaveBeenCalledTimes(3);
    expect(answer).toHaveBeenCalledOnce();
    // A genuinely new server questions block is not suppressed by the earlier acknowledgement.
    read.mockReturnValue(of(detail([{ ...waiting, pendingQuestions: { ...waiting.pendingQuestions, questionsId: 'e'.repeat(64) } }])));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
    expect(text()).not.toContain('already answered these');
    expect(answer).toHaveBeenCalledOnce();
  });

  it('does not show an answered notice from an unrelated run or questions turn', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    answer.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              code: MKTG_RUN_ANSWERED,
              details: { runId: 'f'.repeat(64), questionsId: waiting.pendingQuestions.questionsId, answeredBy: 'Synthetic other writer' },
            },
          })
      )
    );
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button').click();
    await fixture.whenStable();
    expect(text()).not.toContain('already answered these');
    expect(fixture.componentInstance.runState()).toBe('questions');
    expect(answer).toHaveBeenCalledOnce();
  });

  it.each([409, 412])('refreshes current state on %s without repeating answers', async (status) => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    answer.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    await fixture.whenStable();
    read.mockReturnValue(of(detail()));
    fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button').click();
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.runState()).toBe('writing');
    expect(answer).toHaveBeenCalledOnce();
  });

  it('shows a failed send without silently retrying and keeps the entered answer', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    answer.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button').click();
    await fixture.whenStable();
    expect(text()).toContain('Your answers could not be sent');
    expect(fixture.nativeElement.querySelector('textarea').value).toBe('Synthetic maintainers');
    expect(answer).toHaveBeenCalledOnce();
  });

  it('refreshes a waiting row when another browser has answered it', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    await fixture.whenStable();
    read.mockReturnValue(of(detail()));
    fixture.nativeElement.querySelector('[data-testid="mktg-run-progress-questions-refresh"] button').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.runState()).toBe('writing');
    expect(answer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])('keeps unavailable-questions guidance specific to its surface (run page: %s)', async (runPage) => {
    await setup();
    fixture.componentRef.setInput('runPage', runPage);
    read.mockReturnValue(of(detail([{ ...run, state: 'questions' }])));
    await fixture.whenStable();
    if (runPage) {
      expect(text()).toContain('Answering needs project write access or the browser that started this run. Refresh progress to check again.');
      expect(text()).not.toContain('Open the intake form');
    } else {
      expect(text()).toContain('Open the intake form to continue with an available questions block.');
    }
  });

  it('never mounts public answering for a one-off row even if it carries pendingQuestions', async () => {
    await setup();
    const oneOff = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'run');
    if (!oneOff) throw new Error('Missing synthetic one-off type');
    const documentId = 'run-' + 'e'.repeat(24);
    fixture.componentRef.setInput('agentKey', oneOff.agentKey);
    fixture.componentRef.setInput('documentId', documentId);
    read.mockReturnValue(of({ ...detail([{ ...waiting, agentKey: oneOff.agentKey, documentId }]), type: oneOff, documentId }));
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedRun()?.pendingQuestions).toEqual(waiting.pendingQuestions);
    expect(fixture.nativeElement.querySelector('lfx-mktg-run-questions')).toBeNull();
    fixture.componentInstance['onPublicAnswers']([]);
    expect(answer).not.toHaveBeenCalled();
  });

  it('keeps the same canonical reader when its host starts watching confirmed questions', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    await fixture.whenStable();
    expect(read).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('watchQuestions', true);
    await fixture.whenStable();
    expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.questionsIntervalMs);
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.selectedRun()?.state).toBe('questions');
  });

  it('checks a questions row every ten seconds and preserves unsent edits until the server moves to writing', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    await fixture.whenStable();
    const textarea = fixture.nativeElement.querySelector('textarea');
    textarea.focus();
    textarea.value = 'Synthetic edited audience';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    read.mockReturnValue(of(detail([{ ...waiting, pendingQuestions: { ...waiting.pendingQuestions, questions: [...waiting.pendingQuestions.questions] } }])));
    await vi.advanceTimersByTimeAsync(2 * MKTG_RUN_POLL.questionsIntervalMs);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('textarea')).toBe(textarea);
    expect(fixture.nativeElement.querySelector('textarea').value).toBe('Synthetic edited audience');
    expect(document.activeElement).toBe(textarea);
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('textarea')).toBe(textarea);
    expect(textarea.value).toBe('Synthetic edited audience');
    expect(document.activeElement).toBe(textarea);
    read.mockReturnValue(of(detail()));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.questionsIntervalMs);
    await fixture.whenStable();
    expect(fixture.componentInstance.runState()).toBe('writing');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });

  it('pauses the questions reader while hidden and fetches immediately on return via the shared helper', async () => {
    await setup();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    read.mockReturnValue(of(detail([waiting])));
    await fixture.whenStable();
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.questionsIntervalMs * 3);
    expect(read).toHaveBeenCalledOnce();
    read.mockReturnValue(of(detail()));
    visibility.mockReturnValue('visible');
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.runState()).toBe('writing');
    visibility.mockRestore();
  });

  it.each(['focus', 'visibilitychange'])('rechecks public state on %s and lets stored completion win', async (event) => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    await fixture.whenStable();
    const landed = vi.fn();
    fixture.componentInstance.landed.subscribe(landed);
    const stored = detail([]);
    stored.revisions = [{ id: 'synthetic-current', number: 1 } as MktgDocumentDetailResponse['revisions'][number]];
    read.mockReturnValue(of(stored));
    if (event === 'visibilitychange') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      document.dispatchEvent(new Event(event));
    } else window.dispatchEvent(new Event(event));
    await fixture.whenStable();
    expect(landed).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(answer).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('lets a matching private questions attempt win and never also posts publicly', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    loadAttempt.mockReturnValue({ attempt: { runId }, pendingQuestions: { questionsId: waiting.pendingQuestions.questionsId } });
    const questions = vi.fn();
    fixture.componentInstance.questions.subscribe(questions);
    await fixture.whenStable();
    expect(questions).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    fixture.componentInstance['onPublicAnswers']([]);
    expect(answer).not.toHaveBeenCalled();
  });

  it('cancels a pending answer on subject change so its late ACK cannot refresh another viewer', async () => {
    await setup();
    read.mockReturnValue(of(detail([waiting])));
    const response = new Subject<{ runId: string; state: 'writing' }>();
    answer.mockReturnValue(response);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button').click();
    user.set({ sub: 'synthetic-other-writer' } as User);
    await fixture.whenStable();
    expect(response.observed).toBe(false);
    const reads = read.mock.calls.length;
    response.next({ runId, state: 'writing' });
    expect(read).toHaveBeenCalledTimes(reads);
  });

  it('polls the same public record and emits only a current-document landing, never an inferred revision id', async () => {
    await setup();
    const landed = vi.fn();
    fixture.componentInstance.landed.subscribe(landed);
    await fixture.whenStable();
    const finished = detail([]);
    finished.revisions = [{ id: 'synthetic-stored', number: 1 } as MktgDocumentDetailResponse['revisions'][number]];
    read.mockReturnValue(of(finished));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(read).toHaveBeenLastCalledWith(run.project, run.agentKey, run.documentId, true, undefined, true, runId);
    expect(landed).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('keeps a discarded open run visible with the current-run link rather than landing an older document', async () => {
    await setup();
    const landed = vi.fn();
    fixture.componentInstance.landed.subscribe(landed);
    await fixture.whenStable();
    const replacementId = 'd'.repeat(64);
    const changed = detail([{ ...run, runId: replacementId, startedAt: '2026-10-28T10:01:00Z' }]);
    changed.revisions = [{ id: 'synthetic-older', number: 1 } as MktgDocumentDetailResponse['revisions'][number]];
    read.mockReturnValue(of(changed));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await fixture.whenStable();
    expect(text()).toContain('A newer run replaced this one.');
    const link = fixture.nativeElement.querySelector('[data-testid="mktg-run-progress-current-link"]');
    expect(link.textContent).toContain('Open the newer run');
    expect(link.getAttribute('href')).toContain(`run=${replacementId}`);
    expect(landed).not.toHaveBeenCalled();
  });

  it('accepts a safe optional retired hint and its local short time without rendering a private record', async () => {
    await setup();
    read.mockReturnValue(
      of({
        ...detail([]),
        runs: [{ runId, state: 'discarded', replacedBy: 'e'.repeat(64), closedBy: 'Synthetic writer', closedAt: '2026-10-28T10:00:00Z' }],
      })
    );
    await fixture.whenStable();
    expect(text()).toMatch(/This run was discarded by Synthetic writer at .+; a newer run was started[.]/);
    expect(fixture.componentInstance.selectedRun()?.state).toBe('discarded');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-progress-current-link"]').getAttribute('href')).toContain(`run=${'e'.repeat(64)}`);
  });

  it('renders superseded as terminal navigation only, without feed, stepper or retry', async () => {
    await setup();
    read.mockReturnValue(of({ ...detail([]), runs: [{ runId, state: 'superseded', closedAt: run.startedAt }] }));
    await fixture.whenStable();
    expect(text()).toContain('A newer run replaced this one.');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-progress-current-link"]')?.textContent).toContain('View started runs');
    expect(fixture.nativeElement.querySelector('lfx-mktg-run-activity')).toBeNull();
    expect(fixture.nativeElement.querySelector('lfx-mktg-run-questions')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-document-view-progress-retry"]')).toBeNull();
  });

  it('keeps stored-document metadata current through idle polls, hidden tabs and focus', async () => {
    await setup();
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('continuous', true);
    const empty = detail([]);
    read.mockReturnValue(of(empty));
    await fixture.whenStable();
    const changed = { ...empty, current: { revisionId: 'synthetic-current', changedAt: run.startedAt, changedBy: null } };
    read.mockReturnValue(of(changed));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(fixture.componentInstance['detail']()?.current?.revisionId).toBe('synthetic-current');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    const count = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 3);
    expect(read).toHaveBeenCalledTimes(count);
    visibility.mockReturnValue('visible');
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(count + 1);
    visibility.mockRestore();
  });

  it('does not land when progress is unavailable or no stored document exists', async () => {
    await setup();
    read.mockReturnValue(of({ ...detail([]), progressUnavailable: true }));
    const landed = vi.fn();
    fixture.componentInstance.landed.subscribe(landed);
    await fixture.whenStable();
    expect(landed).not.toHaveBeenCalled();
    expect(text()).toContain('Could not fully refresh');
  });

  it.each([true, false])('emits terminal questions/failure once and refreshes a failed record only once (selected: %s)', async (selected) => {
    await setup();
    read.mockReturnValue(of(detail([{ ...run, state: 'failed', persistenceFailed: true }])));
    const failed = vi.fn();
    fixture.componentInstance.failed.subscribe(failed);
    fixture.componentRef.setInput('runAgentId', type.catalogAgentId);
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('runId', selected ? runId : '');
    await fixture.whenStable();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    if (selected) {
      expect(read).toHaveBeenNthCalledWith(1, run.project, run.agentKey, run.documentId, false, undefined, false, runId);
      expect(read).toHaveBeenLastCalledWith(run.project, run.agentKey, run.documentId, false, runId, false, runId);
    } else {
      expect(read).toHaveBeenNthCalledWith(1, run.project, run.agentKey, run.documentId, false);
      expect(read).toHaveBeenLastCalledWith(run.project, run.agentKey, run.documentId, false, runId);
    }
    expect(text()).toContain('retries saving the existing result');
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);
    fixture.nativeElement.querySelector('[data-testid="mktg-document-view-progress-retry"] button').click();
    expect(retry).toHaveBeenCalledOnce();
    read.mockReturnValue(of(detail([{ ...run, state: 'questions' }])));
    const questions = vi.fn();
    fixture.componentInstance.questions.subscribe(questions);
    fixture.componentRef.setInput('refreshKey', 'refresh');
    fixture.componentRef.setInput('runPage', true);
    await fixture.whenStable();
    expect(questions).toHaveBeenCalledOnce();
    expect(text()).toContain('Answering needs project write access or the browser that started this run. Refresh progress to check again.');
  });

  it('retains the last measured record on transient failure and fails closed on denied reads', async () => {
    await setup();
    await fixture.whenStable();
    read.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(fixture.componentInstance.selectedRun()?.runId).toBe(runId);
    read.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(fixture.componentInstance.selectedRun()).toBeNull();
    expect(fixture.componentInstance['readFailure']()).toContain('write access');
  });

  it('distinguishes loading, measured missing and denied progress without starting a run', async () => {
    await setup();
    const pending = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(pending);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-progress-loading"]')?.getAttribute('aria-busy')).toBe('true');
    pending.next(detail([]));
    await fixture.whenStable();
    expect(text()).toContain('This run is no longer listed');
    read.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    fixture.componentRef.setInput('refreshKey', 'denied');
    await fixture.whenStable();
    expect(text()).toContain('write access');
    expect(fixture.componentInstance.selectedRun()).toBeNull();
  });

  it('bounds unavailable reads and lets manual Refresh reset that budget', async () => {
    await setup();
    await fixture.whenStable();
    read.mockReturnValue(of({ ...detail(), progressUnavailable: true }));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.timeoutMs + MKTG_RUN_POLL.intervalMs);
    await fixture.whenStable();
    expect(text()).toContain('Automatic checks are paused');
    const count = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.timeoutMs);
    expect(read).toHaveBeenCalledTimes(count);
    read.mockReturnValue(of(detail()));
    fixture.nativeElement.querySelector('[data-testid="mktg-document-view-refresh-progress"] button').click();
    await fixture.whenStable();
    expect(text()).not.toContain('Automatic checks are paused');
    expect(read).toHaveBeenCalledTimes(count + 1);
  });

  it('rejects invalid public selectors rather than inferring a completed revision', async () => {
    await setup();
    fixture.componentRef.setInput('runId', 'invalid-run');
    const failed = vi.fn();
    fixture.componentInstance.readError.subscribe(failed);
    await fixture.whenStable();
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
    expect(read).not.toHaveBeenCalled();
    expect(text()).toContain('This run could not be found');
  });

  it('keeps the initial read in flight and exposes creator activity on the next authenticated cycle', async () => {
    await setup();
    user.set(null);
    const initial = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(initial);
    await fixture.whenStable();
    user.set({ sub: 'synthetic-creator' } as User);
    await fixture.whenStable();
    expect(initial.observed).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    const activity = [
      { id: 'synthetic-step', kind: 'checking' as const, label: 'Synthetic creator step', status: 'running' as const, startedAt: run.startedAt },
    ];
    initial.next(detail([{ ...run, activity }]));
    initial.complete();
    await fixture.whenStable();
    expect(text()).not.toContain('Synthetic creator step');
    read.mockReturnValue(of(detail([{ ...run, activity }])));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await fixture.whenStable();
    expect(text()).toContain('Synthetic creator step');
    const replacement = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(replacement);
    user.set({ sub: 'synthetic-other-reader' } as User);
    await fixture.whenStable();
    expect(replacement.observed).toBe(true);
    expect(text()).not.toContain('Synthetic creator step');
  });

  it('refreshes a public questions pause after the owner continues elsewhere', async () => {
    await setup();
    read.mockReturnValue(of(detail([{ ...run, state: 'questions' }])));
    await fixture.whenStable();
    expect(text()).toContain('Waiting for your answers');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(read).toHaveBeenCalledOnce();
    read.mockReturnValue(of(detail()));
    fixture.nativeElement.querySelector('[data-testid="mktg-document-view-refresh-progress"] button').click();
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Writing…');
    expect(text()).not.toContain('Waiting for your answers');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('cancels a previous reader on subject change and hides its creator feed immediately', async () => {
    await setup();
    const old = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(old);
    await fixture.whenStable();
    old.next(
      detail([{ ...run, activity: [{ id: 'synthetic-step', kind: 'checking', label: 'Synthetic creator step', status: 'running', startedAt: run.startedAt }] }])
    );
    await fixture.whenStable();
    expect(text()).toContain('Synthetic creator step');
    const replacement = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(replacement);
    user.set({ sub: 'synthetic-other-reader' } as User);
    await fixture.whenStable();
    expect(old.observed).toBe(false);
    expect(text()).not.toContain('Synthetic creator step');
    expect(replacement.observed).toBe(true);
  });

  it('cancels stale subject responses and never fetches in SSR or externally driven mode', async () => {
    await setup();
    const response = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(response);
    await fixture.whenStable();
    expect(response.observed).toBe(true);
    fixture.componentRef.setInput('polling', false);
    fixture.componentRef.setInput('snapshot', detail());
    await fixture.whenStable();
    expect(response.observed).toBe(false);
    expect(fixture.componentInstance.selectedRun()?.runId).toBe(runId);
    fixture.destroy();
    TestBed.resetTestingModule();
    await setup('server');
    await fixture.whenStable();
    expect(read).not.toHaveBeenCalled();
  });
});

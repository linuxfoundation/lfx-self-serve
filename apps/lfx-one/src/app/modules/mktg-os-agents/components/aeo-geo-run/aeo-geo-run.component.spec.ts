// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MktgRunQuestionsComponent } from '../../mktg-run-questions/mktg-run-questions.component';
import { provideRouter, Router } from '@angular/router';
import { AEO_GEO_INTAKE, AEO_GEO_INTAKE_ERRORS, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgAgentIntake } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { MktgPendingDocumentService } from '@services/mktg-pending-document.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
// package-architecture.md § Import Patterns: test fixtures are not re-exported by the production utils barrel.
import { aeoGeoQuestionsFixture } from '@lfx-one/shared/utils/aeo-geo.fixture';
import { aeoGeoRunQuestions } from '@lfx-one/shared/utils';
import { of, throwError, TimeoutError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AeoGeoRunComponent } from './aeo-geo-run.component';

describe('AeoGeoRunComponent', () => {
  let fixture: ComponentFixture<AeoGeoRunComponent>;
  const getProject = vi.fn();
  const pollPost = vi.fn();
  const listDocuments = vi.fn();
  const start = vi.fn();
  const poll = vi.fn();
  const loadActive = vi.fn();
  const markWriting = vi.fn();
  const answerQuestions = vi.fn();
  const clear = vi.fn();
  const saveQuestionDraft = vi.fn();
  const run = () => ({
    agentId: AEO_GEO_INTAKE.agentId,
    projectUid: 'project-1',
    documentId: 'run-012345678901234567890123',
    sessionId: 'session-1',
    ownerToken: 'owner-proof',
    savedAt: new Date().toISOString(),
  });
  function query(id: string): HTMLElement {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"], [data-test="${id}"]`);
  }
  async function render(intake: MktgAgentIntake = AEO_GEO_INTAKE) {
    fixture = TestBed.createComponent(AeoGeoRunComponent);
    fixture.componentRef.setInput('intake', intake);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function fill(id: string, value: string) {
    const input = query(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  beforeEach(() => {
    pollPost.mockReset();
    getProject.mockReturnValue(of({ writer: true, website_url: 'https://project.example/' }));
    listDocuments.mockReturnValue(of({ groups: [] }));
    start.mockReset().mockReturnValue(of(run()));
    poll.mockReset().mockReturnValue(of({ status: 'ready' }));
    loadActive.mockReset().mockReturnValue(null);
    markWriting.mockReset().mockReturnValue(true);
    answerQuestions.mockReset().mockReturnValue(of(undefined));
    clear.mockReset();
    saveQuestionDraft.mockReset();
    TestBed.configureTestingModule({
      imports: [AeoGeoRunComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ProjectContextService,
          useValue: {
            activeContext: signal({ uid: 'project-1', slug: 'synthetic-project', name: 'Synthetic Project' }),
            activeContextUid: signal('project-1'),
          },
        },
        { provide: ProjectService, useValue: { getProject } },
        { provide: HttpClient, useValue: { post: pollPost } },
        { provide: UserService, useValue: { user: signal({ sub: 'synthetic-sub' }) } },
        { provide: MktgDocumentStoreService, useValue: { listDocuments } },
        { provide: MktgPendingDocumentService, useValue: { start, poll, loadActive, markWriting, answerQuestions, clear, saveQuestionDraft } },
      ],
    });
  });
  it('advises on website/key-page Drive links and normalized repeats without adding a submission gate', async () => {
    await render();
    const url = 'https://drive.google.com/drive/folders/synthetic';
    await fill('mktg-aeo-domain', url);
    expect(query('mktg-aeo-link-warning-domain').textContent).toContain("We can't open private Google Drive links or folders.");
    expect((query('mktg-aeo-run-submit') as HTMLButtonElement).disabled).toBe(false);
    await fill('mktg-aeo-page_1', url);
    await fill('mktg-aeo-page_2', url + '?usp=sharing');
    expect(query('mktg-aeo-link-warning-page_1').textContent).not.toContain('already added above');
    expect(query('mktg-aeo-link-warning-page_1').textContent).toContain("We can't open private Google Drive links or folders.");
    expect(query('mktg-aeo-link-warning-page_2').textContent).toContain('This link is already added above.');
    expect(query('mktg-aeo-link-warning-domain').textContent).not.toContain('already added above');
    expect((query('mktg-aeo-run-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('prefills the website from LFX and distinguishes empty previous runs', async () => {
    await render();
    expect((query('mktg-aeo-domain') as HTMLInputElement).value).toBe('https://project.example/');
    expect(query('mktg-aeo-run-from-lfx')).not.toBeNull();
    expect(query('mktg-aeo-run-empty')).not.toBeNull();
    await fill('mktg-aeo-domain', 'other.example');
    expect(query('mktg-aeo-run-from-lfx')).toBeNull();
  });
  it('accepts none or 2–5 pages and rejects one, repeats and non-http(s) URLs with actionable copy', async () => {
    await render();
    const disabled = () => (query('mktg-aeo-run-submit') as HTMLButtonElement).disabled;
    expect(disabled()).toBe(false);
    await fill('mktg-aeo-page_1', 'https://project.example/about');
    expect(disabled()).toBe(true);
    expect(query('mktg-aeo-run-pages-error').textContent).toContain('Add at least one more');
    await fill('mktg-aeo-page_2', 'https://project.example/about');
    expect(disabled()).toBe(true);
    expect(query('mktg-aeo-run-pages-error').textContent).toContain('repeats');
    await fill('mktg-aeo-page_2', 'ftp://project.example/faq');
    expect(disabled()).toBe(true);
    await fill('mktg-aeo-page_2', 'https://project.example/faq');
    expect(disabled()).toBe(false);
  });
  it.each(['http://10.0.0.1/a', 'https://?'])('shows the shared key-page error for %s rather than silently disabling Run', async (page) => {
    await render();
    await fill('mktg-aeo-page_1', 'https://project.example/about');
    await fill('mktg-aeo-page_2', page);
    expect((query('mktg-aeo-run-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(query('mktg-aeo-run-pages-error').textContent).toContain(AEO_GEO_INTAKE_ERRORS.key_pages);
    expect(start).not.toHaveBeenCalled();
  });
  it.each([
    { count: 1, label: 'previous run' },
    { count: 3, label: 'previous runs' },
  ])('pluralises $count previous reports', async ({ count, label }) => {
    await render();
    fixture.componentInstance['runCount'].set(count);
    fixture.detectChanges();
    const header = query('mktg-aeo-run-history-label').textContent?.replace(/\s+/g, ' ').trim();
    expect(header).toBe(`Synthetic Project · ${count} ${label}`);
  });
  it('starts a fresh audit and navigates to its document destination', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    query('mktg-aeo-run-submit').click();
    await fixture.whenStable();
    expect(start).toHaveBeenCalledWith(AEO_GEO_INTAKE, 'project-1', {
      domain: 'https://project.example/',
      key_pages: '',
      project_name: 'Synthetic Project',
      project_uid: 'project-1',
    });
    expect(navigate).toHaveBeenCalledWith(
      ['..', 'documents', 'aeo-geo', 'run-012345678901234567890123'],
      expect.objectContaining({ queryParamsHandling: 'merge', queryParams: { mode: null } })
    );
  });
  it('recovers a cancelled document handoff without discarding its writing capability', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
    await render();
    query('mktg-aeo-run-submit').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['busy']()).toBe(false);
    expect(query('mktg-aeo-run-error').textContent).toContain('The report page could not be opened.');
    expect(query('mktg-aeo-run-open-document').getAttribute('href')).toContain(`/documents/aeo-geo/${run().documentId}`);
    expect(clear).not.toHaveBeenCalled();
  });
  it('ends a failed run with the supplied failure reason', async () => {
    poll.mockReturnValue(of({ status: 'failed', failureText: 'Synthetic audit failure.' }));
    await render();
    query('mktg-aeo-run-submit').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(query('mktg-aeo-run-error').textContent).toContain('Synthetic audit failure.');
    expect(clear).toHaveBeenCalledWith('project-1', run().documentId);
    expect(fixture.componentInstance['busy']()).toBe(false);
  });
  it('stays on the run page for questions and sends answers before navigating to the document', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const questions = aeoGeoRunQuestions(aeoGeoQuestionsFixture());
    poll.mockReturnValue(of({ status: 'questions', questions, questionsId: 'questions-1' }));
    await render();
    query('mktg-aeo-run-submit').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(navigate).not.toHaveBeenCalled();
    expect(query('mktg-run-questions')).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(MktgRunQuestionsComponent)).componentInstance.allowNonAnswers()).toBe(true);
    fixture.componentInstance['onAnswers']([{ key: questions[0].key, text: questions[0].suggestedAnswer, origin: 'accepted' }]);
    expect(answerQuestions).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }), AEO_GEO_INTAKE, [
      { id: 'audience', text: questions[0].suggestedAnswer, origin: 'accepted' },
    ]);
    expect(navigate).toHaveBeenCalledWith(['..', 'documents', 'aeo-geo', run().documentId], expect.anything());
  });
  it('resumes questions on reload without starting a second session', async () => {
    loadActive.mockReturnValue(run());
    poll.mockReturnValue(of({ status: 'questions', questions: aeoGeoRunQuestions(aeoGeoQuestionsFixture()), questionsId: 'questions-1' }));
    await render();
    expect(start).not.toHaveBeenCalled();
    expect(query('mktg-run-questions')).not.toBeNull();
    expect(query('mktg-aeo-run-form')).toBeNull();
  });
  it('restores Q2 edits after recreation and sends them as edited, clearing the draft', async () => {
    TestBed.overrideProvider(MktgPendingDocumentService, { useFactory: () => new MktgPendingDocumentService() });
    const stored = TestBed.inject(MktgPendingDocumentService);
    stored.clear('project-1', run().documentId);
    vi.spyOn(stored, 'poll').mockReturnValue(of({ status: 'questions', questions: aeoGeoRunQuestions(aeoGeoQuestionsFixture()), questionsId: 'questions-1' }));
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    pollPost.mockReturnValue(of(run()));
    await render();
    query('mktg-aeo-run-submit').click();
    fixture.detectChanges();
    await fixture.whenStable();
    query('mktg-run-questions-next').querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    await fill('mktg-run-questions-answer-aeo-comparison-targets', 'Another synthetic comparison target.');
    stored.saveQuestionDraft({ ...run(), sessionId: 'another-synthetic-session' }, { index: 0, answers: {} });
    fixture.destroy();
    await render();
    expect(query('mktg-run-questions-progress').textContent).toContain('Question 2 of 4');
    expect((query('mktg-run-questions-answer-aeo-comparison-targets') as HTMLTextAreaElement).value).toBe('Another synthetic comparison target.');
    query('mktg-run-questions-chip-aeo-project-identity').click();
    fixture.detectChanges();
    query('mktg-run-questions-send').querySelector<HTMLButtonElement>('button')?.click();
    await fixture.whenStable();
    const sent = pollPost.mock.calls.find(([url]) => url === AEO_GEO_INTAKE.endpoints.answers)?.[1];
    expect(sent.answers[1]).toEqual({ id: 'comparison-targets', text: 'Another synthetic comparison target.', origin: 'edited' });
    expect(stored.load('project-1', run().documentId)?.questionDraft).toBeUndefined();
    stored.clear('project-1', run().documentId);
  });

  it('resumes a writing run at its document instead of asking again', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    loadActive.mockReturnValue({ ...run(), phase: 'writing' });
    await render();
    expect(poll).toHaveBeenCalledWith(expect.objectContaining({ phase: 'writing' }), AEO_GEO_INTAKE);
    expect(start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalled();
  });
  it.each(['pending', 'questions'])('recovers a failed answers acknowledgement when polling returns %s', async (status) => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const questions = aeoGeoRunQuestions(aeoGeoQuestionsFixture());
    poll.mockReturnValue(of({ status: 'questions', questions, questionsId: 'questions-1' }));
    await render();
    query('mktg-aeo-run-submit').click();
    await fixture.whenStable();
    answerQuestions.mockReturnValue(throwError(() => new Error('Lost acknowledgement.')));
    poll.mockReturnValue(of({ status, questions, questionsId: 'questions-1' }));
    fixture.componentInstance['onAnswers']([{ key: questions[0].key, text: 'A retained answer.', origin: 'edited' }]);
    fixture.detectChanges();
    if (status === 'pending') expect(navigate).toHaveBeenCalled();
    else {
      expect(navigate).not.toHaveBeenCalled();
      expect(fixture.componentInstance['error']()).toBe('');
      expect(fixture.componentInstance['questions']()).toHaveLength(4);
      expect(fixture.componentInstance['answerValues']()[questions[0].key]).toBe('A retained answer.');
    }
  });

  it('does not turn a 503 after a failed answers POST into proof of writing, then accepts a real pending', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const questions = aeoGeoRunQuestions(aeoGeoQuestionsFixture());
    poll.mockReturnValue(of({ status: 'questions', questions, questionsId: 'questions-1' }));
    await render();
    query('mktg-aeo-run-submit').click();
    await fixture.whenStable();
    const realPending = TestBed.runInInjectionContext(() => new MktgPendingDocumentService());
    poll.mockImplementation(realPending.poll.bind(realPending));
    answerQuestions.mockReturnValue(throwError(() => new Error('Lost acknowledgement.')));
    pollPost.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 }))).mockReturnValue(of({ status: 'pending' }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      fixture.componentInstance['onAnswers']([{ key: questions[0].key, text: 'A retained answer.', origin: 'edited' }]);
      vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
      expect(navigate).not.toHaveBeenCalled();
      expect(fixture.componentInstance['questions']()).toHaveLength(4);
      expect(fixture.componentInstance['answerValues']()[questions[0].key]).toBe('A retained answer.');
      vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
      expect(navigate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a timed-out run until Run again explicitly clears it and a fresh audit starts', async () => {
    poll.mockReturnValueOnce(throwError(() => new TimeoutError())).mockReturnValue(of({ status: 'ready' }));
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    query('mktg-aeo-run-submit').click();
    fixture.detectChanges();
    expect(clear).not.toHaveBeenCalled();
    expect(query('mktg-aeo-run-error').textContent).toContain('taking longer than expected');
    query('mktg-aeo-run-again').click();
    fixture.detectChanges();
    expect(clear).toHaveBeenCalledWith('project-1', run().documentId);
    query('mktg-aeo-run-submit').click();
    expect(start).toHaveBeenCalledTimes(2);
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[1]);
  });

  it('clears a refused recovered writing run before redirecting and permits a new audit', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    loadActive.mockReturnValue({ ...run(), phase: 'writing' });
    poll.mockReturnValue(of({ status: 'refused', reply: 'Choose an accessible domain.' }));
    await render();
    expect(navigate).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith('project-1', run().documentId);
    expect(query('mktg-aeo-run-form')).not.toBeNull();
    expect((query('mktg-aeo-run-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('surfaces a plain domain-confirmation refusal on the run page, not as questions or a report', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    poll.mockReturnValue(of({ status: 'refused', reply: 'The target is unreachable. Can you confirm the domain?' }));
    await render();
    query('mktg-aeo-run-submit').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(query('mktg-aeo-run-error').textContent).toContain('confirm the domain?');
    expect(query('mktg-run-questions')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith('project-1', run().documentId);
  });
  it('handles an unregistered document type without dereferencing a missing catalog result', async () => {
    await render({ ...AEO_GEO_INTAKE, agentId: 'unregistered-audit' });
    expect(query('mktg-aeo-run-error').textContent).toContain('no registered document type');
    expect(query('mktg-aeo-run-form')).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });
  it('keeps previous reports outside the submission form and uses shared linked breadcrumbs', async () => {
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/project/mktg-os-agents/aeo-geo');
    await render();
    expect(query('mktg-aeo-run-previous').closest('form')).toBeNull();
    expect(query('mktg-breadcrumb-link-0').getAttribute('href')).toBe('/project/mktg-os-agents?project=synthetic-project');
    expect(query('mktg-breadcrumb-link-1').getAttribute('href')).toBe('/project/mktg-os-agents/families/website-web?project=synthetic-project');
    expect(query('mktg-breadcrumb-current').textContent).toBe('AEO/GEO');
    expect(query('mktg-aeo-run-all-reports-link')).not.toBeNull();
  });
  it('exposes a stable retry action when the project lookup fails', async () => {
    getProject.mockReturnValue(of(null));
    await render();
    expect(query('mktg-aeo-run-error').textContent).toContain('could not be loaded');
    expect(query('mktg-aeo-run-retry')).not.toBeNull();
    getProject.mockReturnValue(of({ writer: true, website_url: 'https://project.example/' }));
    query('mktg-aeo-run-retry').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(query('mktg-aeo-run-error')).toBeNull();
    expect(query('mktg-aeo-run-form')).not.toBeNull();
  });
  it('stops loading and asks for project scope when none is selected', async () => {
    TestBed.overrideProvider(ProjectContextService, { useValue: { activeContext: signal(null), activeContextUid: signal(null) } });
    await render();
    expect(query('mktg-aeo-run-loading')).toBeNull();
    expect(query('mktg-aeo-run-error').textContent).toContain('Select a valid project');
  });
  it('shows no access rather than a runnable form for a non-writer', async () => {
    getProject.mockReturnValue(of({ writer: false }));
    await render();
    expect(query('mktg-aeo-run-no-access')).not.toBeNull();
    expect(query('mktg-aeo-run-form')).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });
  it('keeps previous-run errors distinct from empty and preserves inputs after a submission error', async () => {
    listDocuments.mockReturnValue(throwError(() => new Error('store unavailable')));
    start.mockReturnValue(throwError(() => new Error('generation unavailable')));
    await render();
    expect(query('mktg-aeo-run-previous-error')).not.toBeNull();
    expect(query('mktg-aeo-run-empty')).toBeNull();
    query('mktg-aeo-run-submit').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(query('mktg-aeo-run-error').textContent).toContain('inputs are kept');
    expect((query('mktg-aeo-domain') as HTMLInputElement).value).toBe('https://project.example/');
  });
});

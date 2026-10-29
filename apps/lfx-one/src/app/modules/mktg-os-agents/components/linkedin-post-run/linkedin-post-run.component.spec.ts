// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { Location } from '@angular/common';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import {
  LINKEDIN_FILE_ACCEPT,
  LINKEDIN_FILE_TYPES_LABEL,
  LINKEDIN_POST_INTAKE,
  LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY,
  LINKEDIN_PROFILE_EDIT_ORIGINS,
  LINKEDIN_PROFILE_MAX_FIELD_CHARS,
  LINKEDIN_SOURCE_LINK_HINT,
  LINKEDIN_SOURCE_MAX_BYTES,
  MKTG_INTAKE_LINK_ADVICE,
  MKTG_KIT_FAMILIES,
  MKTG_DOCUMENT_TYPES,
  MKTG_PENDING_RUN_STORAGE_KEY_PREFIX,
} from '@lfx-one/shared/constants';
import {
  MktgLastIntake,
  MktgPendingGeneration,
  ProjectContext,
  MktgDocumentDetailResponse,
  MktgDocumentsResponse,
  LinkedinStoredProfile,
} from '@lfx-one/shared/interfaces';
import { linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from '@lfx-one/shared/utils';
import { LinkedinPostService } from '@services/linkedin-post.service';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { ConfirmationService, ConfirmEventType, MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinPostRunComponent } from './linkedin-post-run.component';

describe('LinkedIn profile and post surface', () => {
  const profile = linkedinProfileFromSetup({ name: 'Example author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' });
  const context = signal<ProjectContext | null>({ uid: 'project-one', slug: 'example-project', name: 'Example project' });
  const api = {
    profile: vi.fn(),
    save: vi.fn(),
    startForDocument: vi.fn(),
    setupForDocument: vi.fn(),
  };
  const projects = { getProject: vi.fn() };
  const confirmation = Object.assign(new ConfirmationService(), { confirm: vi.fn<ConfirmationService['confirm']>(), close: vi.fn() });
  const history = { lastIntake: vi.fn() };
  const documents = { getDocument: vi.fn(), listDocuments: vi.fn() };
  const documentType = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === LINKEDIN_POST_INTAKE.agentId);
  if (!documentType) throw new Error('Missing synthetic LinkedIn document type');
  const emptyDetail: MktgDocumentDetailResponse = {
    project: 'project-one',
    type: documentType,
    documentId: 'run-' + 'a'.repeat(24),
    revisions: [],
    approvedCurrent: null,
    runs: [],
  };
  const identity = signal<{ sub: string; name: string } | null>({ sub: 'subject-one', name: 'Example author' });
  beforeEach(async () => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    localStorage.clear();
    api.startForDocument.mockReset();
    documents.listDocuments.mockReset().mockReturnValue(of({ project: 'project-one', groups: [], runs: [] }));
    documents.getDocument.mockReset().mockReturnValue(
      of({
        ...emptyDetail,
        runs: [
          {
            project: emptyDetail.project,
            agentKey: documentType.agentKey,
            documentId: emptyDetail.documentId,
            runId: 'b'.repeat(64),
            state: 'questions',
            startedAt: '2026-10-28T10:00:00Z',
          },
        ],
      })
    );
    api.setupForDocument.mockReturnValue(null);
    identity.set({ sub: 'subject-one', name: 'Example author' });
    projects.getProject.mockReset().mockReturnValue(of({ writer: true }));
    context.set({ uid: 'project-one', slug: 'example-project', name: 'Example project' });
    api.profile.mockReturnValue(of({ profile: null }));
    api.save.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    await TestBed.configureTestingModule({
      imports: [LinkedinPostRunComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ConfirmationService, useValue: confirmation },
        MessageService,
        { provide: LinkedinPostService, useValue: api },
        { provide: MktgDocumentStoreService, useValue: documents },
        { provide: ProjectContextService, useValue: { activeContext: context, activeContextUid: () => context()?.uid } },
        { provide: ProjectService, useValue: projects },
        { provide: UserService, useValue: { user: identity } },
      ],
    }).compileComponents();
    history.lastIntake.mockReset().mockReturnValue(of(null));
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
  });
  async function render() {
    vi.spyOn(TestBed.inject(MktgAgentRunService), 'lastIntake').mockImplementation(history.lastIntake);
    const fixture = TestBed.createComponent(LinkedinPostRunComponent);
    fixture.componentRef.setInput('intake', LINKEDIN_POST_INTAKE);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  it('emits only the neutral run-page loading shape during SSR without profile or intake', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    const fixture = TestBed.createComponent(LinkedinPostRunComponent);
    fixture.componentRef.setInput('intake', LINKEDIN_POST_INTAKE);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-linkedin-loading"] [data-variant="run-page"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="mktg-linkedin-loading"]')?.textContent?.trim()).toBe('Checking the run…');
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-linkedin-identity"]')).toBeNull();
    expect(api.profile).not.toHaveBeenCalled();
    expect(documents.listDocuments).not.toHaveBeenCalled();
  });

  it.each([false, true])('holds the whole header/intake neutral until server run discovery and profile resolve (saved=%s)', async (saved) => {
    const runs = new Subject<MktgDocumentsResponse>();
    const profileRead = new Subject<{ profile: LinkedinStoredProfile | null }>();
    documents.listDocuments.mockReturnValue(runs);
    api.profile.mockReturnValue(profileRead);
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-linkedin-header-loading"]')).not.toBeNull();
    expect(root.querySelector('form')).toBeNull();
    expect(root.textContent).not.toContain('First run');
    expect(api.profile).not.toHaveBeenCalled();
    runs.next({ project: 'project-one', groups: [], runs: [] });
    runs.complete();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-linkedin-header-loading"]')).not.toBeNull();
    profileRead.next({ profile: saved ? { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } : null });
    profileRead.complete();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-linkedin-header-loading"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-linkedin-identity-slot"]')?.classList.contains('h-12')).toBe(true);
    expect(root.querySelector('[data-testid="mktg-linkedin-note-slot"]')?.classList.contains('h-10')).toBe(true);
    expect(root.textContent).toContain(saved ? 'Writing as Example author' : 'First run');
    expect(documents.listDocuments).toHaveBeenCalledExactlyOnceWith('project-one', true, true);
  });

  it.each(['writing', 'questions'] as const)('lands directly on a server-owned %s run with empty browser storage', async (state) => {
    const resume = vi.spyOn(TestBed.inject(MktgAgentRunService), 'resume');
    const row = {
      project: 'project-one',
      agentKey: documentType.agentKey,
      documentId: emptyDetail.documentId,
      runId: 'b'.repeat(64),
      state,
      startedAt: '2026-10-28T10:00:00Z',
    };
    documents.listDocuments.mockReturnValue(of({ project: 'project-one', groups: [], runs: [row], creatorScoped: true }));
    documents.getDocument.mockReturnValue(of({ ...emptyDetail, runs: [row] }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
    const fixture = await render();
    expect(navigate).toHaveBeenCalledWith(
      expect.arrayContaining(['documents', LINKEDIN_POST_INTAKE.agentId, row.documentId]),
      expect.objectContaining({ queryParams: expect.objectContaining({ run: row.runId, generation: null }) })
    );
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-open-accepted"]')).not.toBeNull();
    expect(api.startForDocument).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('discovers this writer’s new run on focus without resetting inputs during a transient read failure', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const fixture = await render();
    const component = fixture.componentInstance;
    component['contentForm'].controls.text.setValue('Synthetic unsent edit');
    documents.listDocuments.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(component['contentForm'].controls.text.value).toBe('Synthetic unsent edit');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).not.toBeNull();
    expect(component['runWarning']()).toContain('checking again');
    documents.listDocuments.mockReturnValue(
      of({
        project: 'project-one',
        groups: [],
        creatorScoped: true,
        runs: [
          {
            project: 'project-one',
            agentKey: documentType.agentKey,
            documentId: emptyDetail.documentId,
            runId: 'b'.repeat(64),
            state: 'writing',
            startedAt: '2026-10-28T10:00:00Z',
          },
        ],
      })
    );
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(component['runWarning']()).toBe('');
    expect(navigate).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('does not auto-land an unadvertised project-wide run from an older server', async () => {
    documents.listDocuments.mockReturnValue(
      of({
        project: 'project-one',
        groups: [],
        runs: [
          {
            project: 'project-one',
            agentKey: documentType.agentKey,
            documentId: emptyDetail.documentId,
            runId: 'b'.repeat(64),
            state: 'writing',
            startedAt: '2026-10-28T10:00:00Z',
          },
        ],
      })
    );
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    const fixture = await render();
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).not.toBeNull();
    expect(fixture.componentInstance['runWarning']()).toContain('could not be verified');
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('settles an initially unavailable run lookup to inputs with a notice and retries on focus', async () => {
    documents.listDocuments.mockReturnValue(of({ project: 'project-one', groups: [], runs: [], creatorScoped: true, progressUnavailable: true }));
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-loading"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).not.toBeNull();
    expect(fixture.componentInstance['runWarning']()).toContain('checking again');
    fixture.componentInstance['contentForm'].controls.text.setValue('Synthetic unsent edit');
    documents.listDocuments.mockReturnValue(of({ project: 'project-one', groups: [], runs: [], creatorScoped: true }));
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(fixture.componentInstance['runWarning']()).toBe('');
    expect(fixture.componentInstance['contentForm'].controls.text.value).toBe('Synthetic unsent edit');
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('does not turn a failed run lookup into a first-run profile or intake', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    documents.listDocuments.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-first-run"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-error"]')?.textContent).toContain('could not be loaded');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-retry-load"]')).not.toBeNull();
    expect(api.profile).not.toHaveBeenCalled();
    log.mockRestore();
  });

  async function fresh() {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/linkedin-post?project=example-project&mode=new');
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    return render();
  }
  it.each(['destroy', 'scope'] as const)(
    'lets an accepted LinkedIn write finish after %s without retaining its capability or navigating',
    async (departure) => {
      const fixture = await fresh();
      const pending = new Subject<{ documentId: string; runId: string; sessionId: string; ownerToken: string }>();
      api.startForDocument.mockReturnValue(pending);
      const attempts = TestBed.inject(MktgRunAttemptService);
      const prepare = vi.spyOn(attempts, 'prepareAccepted');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fixture.componentInstance['contentForm'].controls.text.setValue('Synthetic source for an accepted start.');
      await fixture.componentInstance['onDraft']();
      expect(pending.observed).toBe(true);
      if (departure === 'destroy') fixture.destroy();
      else {
        context.set({ uid: 'project-two', slug: 'synthetic-two', name: 'Synthetic second project' });
        await fixture.whenStable();
      }
      expect(pending.observed).toBe(true);
      pending.next({ documentId: 'run-' + 'a'.repeat(24), runId: 'b'.repeat(64), sessionId: 'synthetic-start', ownerToken: 'synthetic-proof' });
      expect(pending.observed).toBe(false);
      expect(prepare).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      pending.complete();
    }
  );

  it.each(['open', 'discard', 'finished'] as const)('handles a LinkedIn active-run conflict and the %s choice with the exact source', async (choice) => {
    const fixture = await fresh();
    const conflict = {
      code: 'MKTG_RUN_ACTIVE',
      message: 'Your LinkedIn post run is in progress.',
      activeRunId: 'b'.repeat(64),
      state: 'questions',
      agentKey: 'linkedin-post',
      documentId: 'run-' + 'a'.repeat(24),
      startedBy: 'Synthetic writer',
      startedByViewer: true,
      startedAt: '2026-10-19T12:00:00.000Z',
    };
    api.startForDocument
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: conflict })))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: conflict })))
      .mockReturnValue(of({ documentId: 'run-' + 'c'.repeat(24), runId: 'd'.repeat(64), sessionId: 'synthetic-new', ownerToken: 'synthetic-proof' }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentInstance['contentForm'].controls.text.setValue('Synthetic original source');
    await fixture.componentInstance['onDraft']();
    const prompt = confirmation.confirm.mock.calls.at(-1)?.[0];
    expect(prompt).toMatchObject({
      key: 'mktg-active-linkedin',
      header: 'Your LinkedIn post run is in progress',
      acceptLabel: 'Discard and start over',
      rejectLabel: 'Open it',
    });
    expect(fixture.debugElement.injector.get(ConfirmationService)).toBe(confirmation);
    expect(fixture.nativeElement.querySelectorAll('p-confirmdialog')).toHaveLength(1);
    const original = api.startForDocument.mock.calls[0];
    const freshConflict = { ...conflict, activeRunId: 'c'.repeat(64), startedAt: '2026-10-19T13:00:00Z' };
    if (choice !== 'finished') api.startForDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: freshConflict })));
    const notice = vi.spyOn(TestBed.inject(MessageService), 'add');
    window.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(api.startForDocument).toHaveBeenNthCalledWith(3, ...original);
    expect(confirmation.confirm.mock.calls.at(-1)?.[0]).toBe(prompt);
    if (choice === 'finished') {
      expect(confirmation.close).toHaveBeenCalled();
      expect(notice).toHaveBeenCalledWith(expect.objectContaining({ detail: 'The earlier run has finished — yours started.' }));
      expect(navigate).toHaveBeenCalled();
      window.dispatchEvent(new Event('focus'));
      expect(api.startForDocument).toHaveBeenCalledTimes(3);
      return;
    }
    expect(prompt?.message).toContain('19 Oct 2026');
    if (choice === 'discard') {
      fixture.componentInstance['contentForm'].controls.text.setValue('Edited while confirming');
      prompt?.accept?.();
      prompt?.accept?.(); // One dialog cannot authorize two replacement starts.
      expect(api.startForDocument).toHaveBeenCalledTimes(4);
      expect(api.startForDocument).toHaveBeenNthCalledWith(2, ...original);
      expect(api.startForDocument).toHaveBeenNthCalledWith(4, ...original, freshConflict.activeRunId);
    } else {
      prompt?.reject?.(ConfirmEventType.REJECT);
      expect(api.startForDocument).toHaveBeenCalledTimes(3);
      expect(navigate).toHaveBeenCalledWith(
        expect.arrayContaining(['documents', 'linkedin-post', conflict.documentId]),
        expect.objectContaining({ queryParams: expect.objectContaining({ run: freshConflict.activeRunId }) })
      );
    }
  });

  it.each([
    { source: 'text', text: 'Synthetic previous text', url: '', share: '' },
    { source: 'url', text: '', url: 'https://source.example/', share: 'https://share.example/' },
    { source: 'file', text: '', url: '', share: '' },
  ])('restores $source last inputs only in fresh mode, without polling or generating', async ({ source, text, url, share }) => {
    history.lastIntake.mockReturnValue(
      of({ answers: { content_source: source, content_text: text, content_url: url, share_link: share }, documentCount: 0, logoCount: 0 })
    );
    const fixture = await fresh();
    expect(history.lastIntake).toHaveBeenCalledWith('project-one', 'linkedin-post');
    expect(fixture.componentInstance['source']()).toBe(source);
    expect(fixture.componentInstance['contentForm'].getRawValue()).toMatchObject({ text, url, share_link: share });
    expect(api.startForDocument).not.toHaveBeenCalled();
    TestBed.inject(HttpTestingController).expectNone(LINKEDIN_POST_INTAKE.endpoints.result);
    if (source === 'file') expect(fixture.nativeElement.textContent).toContain('choose it again');
  });
  it('warns about a restored Drive URL without editing or disabling drafting', async () => {
    history.lastIntake.mockReturnValue(
      of({ answers: { content_source: 'url', content_url: 'https://drive.google.com/file/d/synthetic/view' }, documentCount: 0, logoCount: 0 })
    );
    const fixture = await fresh();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-link-warning"]')?.textContent).toContain(MKTG_INTAKE_LINK_ADVICE.drivePrivate);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-draft"] button')?.disabled).toBe(false);
    fixture.componentInstance['contentForm'].controls.url.setValue('https://project.example/article');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-link-warning"]')).toBeNull();
    fixture.componentInstance['contentForm'].controls.url.setValue('');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-link-warning"]')).toBeNull();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });
  it.each(['', 'https://share.example/previous'])('keeps the restored share link %s when the URL source is edited', async (share) => {
    history.lastIntake.mockReturnValue(
      of({ answers: { content_source: 'url', content_url: 'https://source.example/previous', share_link: share }, documentCount: 0, logoCount: 0 })
    );
    const fixture = await fresh();
    const form = fixture.componentInstance['contentForm'];
    expect(form.controls.share_link.dirty).toBe(true);
    form.controls.url.setValue('https://source.example/edited');
    expect(form.controls.share_link.value).toBe(share);
    expect(api.startForDocument).not.toHaveBeenCalled();
  });
  it('replaces fresh entry mode before pushing the accepted Document, without an in-page resume', async () => {
    const session = { documentId: 'run-' + 'a'.repeat(24), runId: 'b'.repeat(64), sessionId: 'synthetic-session', ownerToken: 'synthetic-proof' };
    api.startForDocument.mockReturnValue(of(session));
    const fixture = await fresh();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');
    fixture.componentInstance['contentForm'].controls.text.setValue('New source');
    await fixture.componentInstance['onDraft']();
    await fixture.whenStable();
    expect(navigate.mock.calls[0]).toEqual([[], expect.objectContaining({ queryParams: { mode: null }, queryParamsHandling: 'merge', replaceUrl: true })]);
    expect(navigate.mock.calls[1]?.[0]).toEqual(expect.arrayContaining(['documents', LINKEDIN_POST_INTAKE.agentId, session.documentId]));
    expect(router.url).toContain('/documents/linkedin-post/');
    expect(router.url).not.toContain('mode=');
    expect(api.startForDocument).toHaveBeenCalledOnce();
    TestBed.inject(HttpTestingController).expectNone(LINKEDIN_POST_INTAKE.endpoints.result);
  });
  it('asks for pasted text again when the latest oversized snapshot omitted it', async () => {
    history.lastIntake.mockReturnValue(of({ answers: { content_source: 'text', share_link: 'https://current.example/' }, documentCount: 0, logoCount: 0 }));
    const fixture = await fresh();
    expect(fixture.componentInstance['contentForm'].getRawValue()).toMatchObject({ text: '', share_link: 'https://current.example/' });
    expect(fixture.nativeElement.textContent).toContain('paste it again');
    await fixture.componentInstance['onDraft']();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });
  it('does not request last inputs on a normal entry', async () => {
    await render();
    expect(history.lastIntake).not.toHaveBeenCalled();
  });
  it('does not request last inputs without writer access', async () => {
    projects.getProject.mockReturnValue(of({ writer: false }));
    await fresh();
    expect(history.lastIntake).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])('distinguishes denied and unavailable history (%s)', async (status) => {
    history.lastIntake.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    const fixture = await fresh();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-intake-note"]')?.textContent).toContain(
      status === 503 ? 'Last run inputs could not be loaded' : 'You need write access'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-draft"] button')?.disabled).toBe(false);
  });
  it('keeps a user source choice made while last inputs are loading', async () => {
    const pending = new Subject<MktgLastIntake | null>();
    history.lastIntake.mockReturnValue(pending);
    const fixture = await fresh();
    fixture.componentInstance['onSource']('url');
    pending.next({ answers: { content_source: 'text', content_text: 'older source' }, documentCount: 0, logoCount: 0 });
    expect(fixture.componentInstance['source']()).toBe('url');
    expect(fixture.componentInstance['contentForm'].controls.text.value).toBe('');
  });
  it('keeps user-entered text when a delayed history response arrives', async () => {
    const pending = new Subject<MktgLastIntake | null>();
    history.lastIntake.mockReturnValue(pending);
    const fixture = await fresh();
    fixture.componentInstance['contentForm'].controls.text.setValue('New source');
    fixture.componentInstance['contentForm'].markAsDirty();
    pending.next({ answers: { content_source: 'text', content_text: 'older source' }, documentCount: 0, logoCount: 0 });
    expect(fixture.componentInstance['contentForm'].controls.text.value).toBe('New source');
  });
  it.each(['project', 'user'])('cancels stale source restoration when %s access changes', async (scope) => {
    const pending = new Subject<MktgLastIntake | null>();
    history.lastIntake.mockReturnValue(pending);
    const fixture = await fresh();
    projects.getProject.mockReturnValue(of({ writer: false }));
    if (scope === 'project') context.set({ uid: 'other-project', slug: 'other-project', name: 'Synthetic other project' });
    else identity.set({ sub: 'other-subject', name: 'Synthetic other author' });
    await fixture.whenStable();
    pending.next({ answers: { content_text: 'old-private-source' }, documentCount: 0, logoCount: 0 });
    expect(fixture.componentInstance['contentForm'].controls.text.value).toBe('');
    expect(history.lastIntake).toHaveBeenCalledTimes(1);
  });
  async function savedIntake() {
    const fixture = await render();
    fixture.componentInstance['editing'].set(false);
    fixture.componentInstance['saved'].set({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  it.each(['text', 'url'] as const)('rejects empty pasted text and non-HTTPS URLs without a Generate POST (%s)', async (source) => {
    const fixture = await savedIntake();
    const component = fixture.componentInstance;
    component['onSource'](source);
    if (source === 'url') component['contentForm'].controls.url.setValue('http://source.example/not-https');
    component['contentForm'].controls.share_link.setValue(''); // Test the source guard, not optional-link validation.
    await component['onDraft']();
    expect(component['error']()).toBe('Supply pasted text or one public HTTPS link.');
    fixture.detectChanges();
    const form = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]');
    expect(form.querySelector('[data-testid="mktg-linkedin-error"][aria-live="polite"]')?.textContent).toContain(component['error']());
    expect(form.querySelector('[data-testid="mktg-linkedin-draft"] button')?.disabled).toBe(false);
    expect(component['busy']()).toBe(false);
    expect(api.startForDocument).not.toHaveBeenCalled();
    TestBed.inject(HttpTestingController).expectNone(LINKEDIN_POST_INTAKE.endpoints.generate);
  });

  it.each(['lastIntakeDenied', 'acceptedRequest'] as const)('explains %s on draft press without generating again', async (state) => {
    const fixture = await savedIntake();
    const component = fixture.componentInstance;
    if (state === 'lastIntakeDenied') component['lastIntakeDenied'].set(true);
    else component['acceptedRequest'].set(intakePending().request);
    await component['onDraft']();
    fixture.detectChanges();
    const message =
      state === 'lastIntakeDenied'
        ? 'Your last run inputs could not be read; paste text, a link or a file to draft.'
        : 'Your draft is already started — use Open draft above.';
    if (state === 'acceptedRequest') {
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-accepted"]')?.textContent).toContain('Your draft was started');
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-open-accepted"] button')).not.toBeNull();
      expect(component['error']()).toBe(message);
    } else
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"] [data-testid="mktg-linkedin-error"]')?.textContent).toContain(
        message
      );
    expect(api.startForDocument).not.toHaveBeenCalled();
  });
  it('uses the board profile copy and a rightmost always-available primary with Cancel to its left', async () => {
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    const form = root.querySelector('[data-testid="mktg-linkedin-profile-form"]');
    expect(form?.querySelector('h1')?.className).toContain('font-display');
    for (const token of ['font-light', 'text-xl', 'text-gray-900']) expect(form?.querySelector('h1')?.classList.contains(token)).toBe(true);
    for (const label of ['Your name', 'Your role', 'Your main focus areas', 'Projects you are closely associated with', 'Your main LinkedIn audience']) {
      expect(form?.textContent).toContain(label);
    }
    expect(form?.textContent).toContain('Asked once. Every post is written in your voice; change it any time from Edit profile.');
    const save = form?.querySelector('[data-testid="mktg-linkedin-save-profile"]');
    expect(save?.textContent).toContain('Continue to draft a post');
    expect(save?.parentElement?.lastElementChild).toBe(save);
    expect(save?.parentElement?.parentElement?.textContent).toContain('Saved to your profile when your first draft finishes.');
    expect(save?.querySelector('button')?.disabled).toBe(false);
    fixture.componentInstance['saved'].set({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    fixture.componentInstance['busy'].set(true);
    fixture.detectChanges();
    expect(save?.previousElementSibling?.getAttribute('data-testid')).toBe('mktg-linkedin-cancel-edit');
    expect(save?.querySelector('button')?.disabled).toBe(false);
    await fixture.componentInstance['onProfileSubmit']();
    expect(api.save).not.toHaveBeenCalled();
  });
  it('uses light-blue source tabs and a rightmost primary that stays enabled while busy', async () => {
    const fixture = await savedIntake();
    const root: HTMLElement = fixture.nativeElement;
    const title = root.querySelector('h1');
    for (const token of ['font-display', 'font-light', 'text-xl', 'text-gray-900']) expect(title?.classList.contains(token)).toBe(true);
    expect(title?.textContent).toBe('Draft a post');
    const text = root.querySelector('[data-testid="mktg-linkedin-source-text"]');
    expect(text?.classList.contains('bg-blue-50')).toBe(true);
    expect(text?.classList.contains('text-blue-700')).toBe(true);
    expect(text?.classList.contains('bg-gray-900')).toBe(false);
    fixture.componentInstance['onSource']('url');
    fixture.detectChanges();
    expect(text?.getAttribute('aria-pressed')).toBe('false');
    const url = root.querySelector('[data-testid="mktg-linkedin-source-url"]');
    expect(url?.classList.contains('bg-blue-50')).toBe(true);
    expect(url?.classList.contains('text-blue-700')).toBe(true);
    const draft = root.querySelector('[data-testid="mktg-linkedin-draft"]');
    expect(draft?.parentElement?.lastElementChild).toBe(draft);
    expect(draft?.previousElementSibling?.textContent).toBe('About a minute. Each draft is saved under LinkedIn posts.');
    expect(draft?.querySelector('button')?.classList.contains('p-button-outlined')).toBe(false);
    fixture.componentInstance['busy'].set(true);
    fixture.detectChanges();
    expect(draft?.querySelector('button')?.disabled).toBe(false);
    expect(draft?.textContent).toContain('Drafting…');
    await fixture.componentInstance['onDraft']();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('keeps Open draft as the only primary after a first-run recorded draft cannot navigate', async () => {
    TestBed.inject(MktgRunAttemptService).save(intakePending('writing'));
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-form"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-open-accepted"] button')?.classList.contains('p-button-outlined')).toBe(false);
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('prefills first-run setup from creator/project live memory on return, not in a fresh visit', async () => {
    const setup = { ...profile.about, ...profile.voice };
    api.setupForDocument.mockReturnValueOnce(setup).mockReturnValue(null);
    const first = await render();
    expect(api.setupForDocument).toHaveBeenCalledWith('project-one');
    expect(first.componentInstance['profileForm'].getRawValue()).toMatchObject(setup);
    expect(first.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-form"]')).not.toBeNull();
    expect(first.nativeElement.querySelector('[data-testid="mktg-linkedin-pending-notice"]')).toBeNull();
    first.destroy();
    const fresh = await render();
    expect(fresh.componentInstance['profileForm'].getRawValue()).toMatchObject({ name: 'Example author', role: '', focus_areas: '', primary_audience: '' });
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('does not restore a cached questions state the server no longer lists', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    TestBed.inject(MktgRunAttemptService).save(intakePending());
    documents.getDocument.mockReturnValue(of(emptyDetail));
    documents.listDocuments.mockReturnValue(of({ project: 'project-one', groups: [], runs: [] }));
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-questions"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-pending-notice"]')).toBeNull();
    expect(fixture.componentInstance['recordedPending']()).toBeNull();
    const retained = TestBed.inject(MktgRunAttemptService).load('project-one', LINKEDIN_POST_INTAKE.agentId, emptyDetail.documentId);
    expect(retained?.pendingQuestions).toBeUndefined();
    expect(retained?.attempt).toBeUndefined();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it.each(['writing', 'landed'] as const)('uses measured %s instead of stale latestPending questions', async (state) => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const pending = intakePending();
    TestBed.inject(MktgRunAttemptService).save(pending);
    const measured = new Subject<MktgDocumentDetailResponse>();
    documents.getDocument.mockReturnValue(measured);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-header-loading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-loading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-questions"]')).toBeNull();
    const detail: MktgDocumentDetailResponse = {
      ...emptyDetail,
      runs:
        state === 'writing'
          ? [
              {
                project: emptyDetail.project,
                agentKey: documentType.agentKey,
                documentId: emptyDetail.documentId,
                runId: pending.attempt?.runId ?? '',
                state: 'writing',
                startedAt: '2026-10-28T10:00:00Z',
              },
            ]
          : [],
    };
    if (state === 'landed') detail.revisions = [{ id: 'synthetic-current', number: 1 } as MktgDocumentDetailResponse['revisions'][number]];
    measured.next(detail);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-questions"]')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(expect.arrayContaining(['documents', LINKEDIN_POST_INTAKE.agentId, pending.request.documentId]), expect.anything());
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('opens server questions on the document instead of restoring a stale local writing intake on load or reload', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const attempts = TestBed.inject(MktgRunAttemptService);
    const pending = intakePending('writing');
    attempts.save(pending);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const first = await render();
    expect(navigate).toHaveBeenCalledWith(
      expect.arrayContaining(['documents', LINKEDIN_POST_INTAKE.agentId, pending.request.documentId]),
      expect.objectContaining({ queryParams: expect.objectContaining({ run: pending.attempt?.runId }) })
    );
    expect(first.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
    expect(first.nativeElement.querySelector('[data-testid="mktg-linkedin-questions"]')).toBeNull();
    first.destroy();
    await render();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(api.startForDocument).not.toHaveBeenCalled();
    TestBed.inject(HttpTestingController).expectNone(LINKEDIN_POST_INTAKE.endpoints.result);
  });

  function intakePending(state: MktgPendingGeneration['state'] = 'questions'): MktgPendingGeneration {
    if (!documentType) throw new Error('Missing synthetic LinkedIn document type');
    const intake = LINKEDIN_POST_INTAKE;
    const documentId = 'run-' + 'a'.repeat(24);
    // Synthetic BFF fixture is independent from browser persistence; stale-cache cases override it explicitly.
    if (state === 'writing' || state === 'questions' || state === 'failed')
      documents.listDocuments.mockReturnValue(
        of({
          project: 'project-one',
          groups: [],
          runs: [{ project: 'project-one', agentKey: documentType.agentKey, documentId, runId: 'b'.repeat(64), state, startedAt: '2026-10-28T10:00:00Z' }],
        })
      );
    const attempt = {
      documentId,
      runId: 'b'.repeat(64),
      priorVersion: 0,
      session: { agentId: intake.agentId, sessionId: 'synthetic-session', ownerToken: 'synthetic-proof' },
    };
    return {
      request: { agentId: intake.agentId, intake, projectUid: 'project-one', documentId, answers: {} },
      attempt,
      state,
      updatedAt: new Date().toISOString(),
      ...(state === 'questions' && {
        pendingQuestions: {
          attempt,
          questionsId: 'a'.repeat(64),
          questions: [
            {
              key: 'tendency',
              label: 'Tendency',
              question: 'How direct should these posts sound?',
              why: 'Voice gap.',
              suggestedAnswer: 'Direct and practical.',
              basis: ['inferred'],
            },
          ],
        },
      }),
    };
  }
  it.each([true, false])('server-owned questions win over both plain and new-mode intake (fresh=%s)', async (freshMode) => {
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.save(intakePending());
    const latest = vi.spyOn(attempts, 'latestPending');
    const load = vi.spyOn(attempts, 'load');
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    history.lastIntake.mockReturnValue(
      of({ answers: { content_source: 'text', content_text: 'Synthetic last input', share_link: '' }, documentCount: 0, logoCount: 0 })
    );
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/linkedin-post?project=example-project' + (freshMode ? '&mode=new' : ''));
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-linkedin-questions"]')).not.toBeNull();
    expect(fixture.componentInstance['questions']()).toHaveLength(1);
    expect(fixture.componentInstance['pendingNotice']()).toMatchObject({ state: 'questions', documentId: 'run-' + 'a'.repeat(24) });
    if (freshMode) expect(latest).not.toHaveBeenCalled();
    else expect(latest).toHaveBeenCalledWith('project-one', 'linkedin-post');
    expect(load).toHaveBeenCalledWith('project-one', 'linkedin-post', 'run-' + 'a'.repeat(24));
    expect(api.startForDocument).not.toHaveBeenCalled();
    TestBed.inject(HttpTestingController).expectNone(LINKEDIN_POST_INTAKE.endpoints.result);
  });

  async function questionsIntake() {
    const attempts = TestBed.inject(MktgRunAttemptService);
    const pending = intakePending();
    attempts.save(pending);
    const token = attempts.prepare(pending.request, true);
    vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.queryParamMap, 'get').mockImplementation((key) => (key === 'questions' ? token : null));
    return savedIntake();
  }
  it('retains the confirmed questions node and edits during an unavailable background read', async () => {
    const fixture = await questionsIntake();
    const component = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    const textarea = root.querySelector<HTMLTextAreaElement>('[data-testid="mktg-linkedin-questions"] textarea');
    if (!textarea) throw new Error('Missing synthetic questions');
    textarea.value = 'Synthetic unsent answer';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
    const answer = vi.spyOn(TestBed.inject(MktgAgentRunService), 'answerQuestions');
    component['onRecordedReadError']();
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-linkedin-questions"] textarea')).toBe(textarea);
    expect(textarea.value).toBe('Synthetic unsent answer');
    expect(document.activeElement).toBe(textarea);
    component['onAnswers']([]);
    expect(answer).not.toHaveBeenCalled();
    const run = component['serverRun']();
    if (!run) throw new Error('Missing recorded run');
    component['onRecordedProgress']({ detail: { ...emptyDetail, runs: [{ ...run, state: 'questions' }] }, view: null });
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-linkedin-questions"] textarea')).toBe(textarea);
    expect(textarea.value).toBe('Synthetic unsent answer');
    expect(component['runLookupFailed']()).toBe(false);
  });

  it('keeps intake submission explicit, textarea Enter editable, source guidance truthful and landmarks unnested', async () => {
    const fixture = await savedIntake();
    const element: HTMLElement = fixture.nativeElement;
    fixture.componentInstance['contentForm'].controls.text.setValue('Synthetic valid source.');
    const form = element.querySelector('[data-testid="mktg-linkedin-post-form"]');
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form?.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(element.querySelector<HTMLButtonElement>('[data-testid="mktg-linkedin-draft"] button')?.type).toBe('button');
    const shareEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    element.querySelector('#linkedin-share-link')?.dispatchEvent(shareEnter);
    expect(shareEnter.defaultPrevented).toBe(true);
    const textareaEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const textarea = element.querySelector('#linkedin-content-text');
    expect(textarea).not.toBeNull();
    textarea?.dispatchEvent(textareaEnter);
    expect(textareaEnter.defaultPrevented).toBe(false);
    fixture.componentInstance['onSource']('url');
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="mktg-linkedin-source-hint"]')?.textContent).toContain(LINKEDIN_SOURCE_LINK_HINT);
    expect(element.textContent).not.toContain('cannot browse');
    expect(element.querySelector('main, aside')).toBeNull();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it.each(['false', 'throw', 'empty'] as const)(
    'keeps acceptance after %s navigation/token failure; Open never Generates and edits allow a new run',
    async (failure) => {
      api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
      const session = { documentId: 'run-' + 'a'.repeat(24), runId: 'b'.repeat(64), sessionId: 'synthetic-session', ownerToken: 'synthetic-proof' };
      api.startForDocument.mockReturnValue(of(session));
      const attempts = TestBed.inject(MktgRunAttemptService);
      const accept = vi.spyOn(attempts, 'prepareAccepted');
      const opening = new Subject<boolean>();
      if (failure === 'empty') accept.mockReturnValueOnce('');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      if (failure === 'false') navigate.mockResolvedValueOnce(false);
      if (failure === 'throw') navigate.mockRejectedValueOnce(new Error('Synthetic navigation failure'));
      TestBed.inject(ActivatedRoute).snapshot.queryParams = {
        source: 'url',
        content_text: 'private-marker',
        content_url: 'https://private.example/raw',
        setup: 'private-setup',
      };
      const fixture = await render();
      fixture.componentInstance['source'].set('url');
      fixture.componentInstance['contentForm'].controls.url.setValue('https://source.example/content');
      fixture.componentInstance['contentForm'].controls.share_link.setValue('https://share.example/post');
      await fixture.componentInstance['onDraft']();
      await fixture.whenStable();
      expect(accept).toHaveBeenCalledOnce();
      if (failure !== 'empty') expect(navigate.mock.calls[0]?.[1]?.queryParams?.['generation']).toMatch(/^generation-/);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-accepted"]').textContent).toContain(
        'Your draft was started — open it to follow progress.'
      );
      const accepted = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-accepted"]') as HTMLElement;
      for (const token of ['rounded-lg', 'border', 'p-4']) expect(accepted.classList.contains(token)).toBe(true);
      expect(accepted.getAttribute('role')).toBeNull();
      expect(accepted.querySelector('p')?.getAttribute('role')).toBe('status');
      expect(accepted.querySelector('[role="status"] button')).toBeNull();
      expect(fixture.componentInstance['error']()).toBe('');
      // The durable ACK forbids another start; the visible, keyboard-accessible Open action is recovery, not a second Draft.
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-draft"] button')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-open-accepted"] button')?.disabled).toBe(false);
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-open-accepted"] button')?.classList.contains('p-button-outlined')).toBe(false);
      await fixture.componentInstance['onDraft']();
      navigate.mockReturnValueOnce(firstValueFrom(opening));
      fixture.componentInstance['onOpenAccepted']();
      await fixture.whenStable();
      expect(api.startForDocument).toHaveBeenCalledExactlyOnceWith(
        LINKEDIN_POST_INTAKE,
        'project-one',
        { content_source: 'url', content_url: 'https://source.example/content', share_link: 'https://share.example/post' },
        undefined
      );
      const query = navigate.mock.calls.at(-1)?.[1]?.queryParams;
      expect(query).toMatchObject({ source: 'url', profile: null });
      for (const text of ['private-marker', 'private.example', 'private-setup', 'source.example', 'share.example', session.ownerToken])
        expect(JSON.stringify(query)).not.toContain(text);
      expect(navigate).toHaveBeenLastCalledWith(
        expect.arrayContaining(['documents', LINKEDIN_POST_INTAKE.agentId, session.documentId]),
        expect.objectContaining({ queryParams: expect.objectContaining({ generation: null }) })
      );
      const entries = Object.entries(localStorage).filter(([key]) => key.startsWith(MKTG_PENDING_RUN_STORAGE_KEY_PREFIX));
      expect(entries).toHaveLength(failure === 'empty' ? 0 : 1);
      for (const [, value] of entries) expect(JSON.parse(value).request.answers).toEqual({});
      for (const text of ['source.example', 'private-marker', 'private-setup']) expect(JSON.stringify({ ...localStorage })).not.toContain(text);
      TestBed.inject(HttpTestingController).expectNone(LINKEDIN_POST_INTAKE.endpoints.result);
      expect(Object.keys(localStorage).every((key) => key.startsWith(MKTG_PENDING_RUN_STORAGE_KEY_PREFIX))).toBe(true);
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="mktg-linkedin-results"], [data-testid="mktg-linkedin-generating"], [data-testid="mktg-linkedin-open-document"]'
        )
      ).toBeNull();
      fixture.componentInstance['applySource']('text');
      fixture.componentInstance['contentForm'].controls.text.setValue('Synthetic changed source.');
      opening.next(false);
      await fixture.whenStable();
      expect(fixture.componentInstance['busy']()).toBe(false);
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-open-accepted"]')).toBeNull();
      await fixture.componentInstance['onDraft']();
      expect(api.startForDocument).toHaveBeenCalledTimes(2);
      expect(api.startForDocument.mock.calls.at(-1)?.[2]).toMatchObject({ content_text: 'Synthetic changed source.' });
    }
  );

  it.each(['memory', 'no-text', 'none'] as const)('recovers a consumed questions URL from the existing attempt cache (%s)', async (mode) => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const attempts = TestBed.inject(MktgRunAttemptService);
    const pending = intakePending();
    attempts.save(pending);
    const token = attempts.prepare(pending.request, true);
    expect(attempts.consumeQuestions(token, 'project-one', LINKEDIN_POST_INTAKE.agentId)).not.toBeNull();
    if (mode === 'no-text') attempts.save({ ...pending, pendingQuestions: undefined });
    if (mode === 'none') attempts.clear('project-one', LINKEDIN_POST_INTAKE.agentId, attempts.subject(), pending.request.documentId);
    vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.queryParamMap, 'get').mockImplementation((key) => (key === 'questions' ? token : null));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-linkedin-questions"]') !== null).toBe(mode === 'memory');
    expect(root.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
    if (mode === 'memory') {
      expect(root.querySelector('[data-testid="mktg-linkedin-pending-notice"]')?.textContent).toContain('Your draft is waiting for your answers');
      expect(navigate).not.toHaveBeenCalled();
    } else
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        expect.arrayContaining(['documents', LINKEDIN_POST_INTAKE.agentId, pending.request.documentId]),
        expect.objectContaining({ replaceUrl: true, queryParams: expect.objectContaining({ questions: null, generation: null, run: pending.attempt?.runId }) })
      );
    expect(api.startForDocument).not.toHaveBeenCalled();
    TestBed.inject(HttpTestingController).expectNone(LINKEDIN_POST_INTAKE.endpoints.result);
  });

  it('follows writing after a creator-token answers conflict with the same safe notification', async () => {
    const fixture = await questionsIntake();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const notify = vi.spyOn(TestBed.inject(MessageService), 'add');
    const answers = [{ key: 'tendency', text: 'Synthetic answer', origin: 'requester' as const }];
    fixture.componentInstance['onAnswers'](answers);
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne(LINKEDIN_POST_INTAKE.endpoints.answers ?? '')
      .flush(
        { code: 'MKTG_RUN_ANSWERED', details: { answeredBy: 'Synthetic writer', answeredAt: '2026-10-28T10:01:00Z' } },
        { status: 409, statusText: 'Conflict' }
      );
    await fixture.whenStable();
    expect(notify).toHaveBeenCalledWith({ severity: 'info', summary: 'Synthetic writer already answered these — the agent is writing.' });
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-questions"]')).toBeNull();
    expect(fixture.componentInstance['error']()).toBe('');
    expect(navigate).toHaveBeenCalledWith(
      expect.arrayContaining(['documents', LINKEDIN_POST_INTAKE.agentId]),
      expect.objectContaining({ queryParams: expect.objectContaining({ generation: null }) })
    );
    fixture.componentInstance['onAnswers'](answers);
    http.expectNone(LINKEDIN_POST_INTAKE.endpoints.answers ?? '');
  });

  it('consumes shared questions and returns on the same-session answers ACK without polling on the form', async () => {
    const intake = LINKEDIN_POST_INTAKE;
    const consume = vi.spyOn(TestBed.inject(MktgRunAttemptService), 'consumeQuestions');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await questionsIntake();
    expect(consume).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^generation-/), 'project-one', intake.agentId);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-questions"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
    const answers = [{ key: 'tendency', text: 'Synthetic answer.', origin: 'requester' as const }];
    const http = TestBed.inject(HttpTestingController);
    fixture.componentInstance['onAnswers'](answers);
    const send = http.expectOne(intake.endpoints.answers ?? '');
    expect(send.request.body).toMatchObject({ sessionId: 'synthetic-session', ownerToken: 'synthetic-proof', questionsId: 'a'.repeat(64), answers });
    send.flush({ success: true });
    expect(navigate).toHaveBeenCalledWith(
      expect.arrayContaining(['documents', intake.agentId, 'run-' + 'a'.repeat(24)]),
      expect.objectContaining({ queryParams: expect.objectContaining({ generation: expect.stringMatching(/^generation-/) }) })
    );
    http.expectNone(intake.endpoints.result);
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it.each([undefined, 'text', 'file', 'url', 'bad-value'])(
    'opens failed intake with safe source %s and re-entry prompts, never polling a dead session',
    async (source) => {
      if (source !== undefined) api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
      const attempts = TestBed.inject(MktgRunAttemptService);
      const pending = intakePending('failed');
      if (source === undefined) pending.attempt = undefined; // A plain server-read failure needs no owner capability to open an intake.
      attempts.save(pending);
      const token = attempts.prepare(pending.request, true);
      vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.queryParamMap, 'get').mockImplementation((key) => {
        if (key === 'questions') return token;
        if (key === 'source') return source ?? null;
        return null;
      });
      const fixture = await render();
      const expected = source === 'file' || source === 'url' ? source : 'text';
      const prompts = { text: 'paste it again', file: 'choose the file again', url: 'enter the link again' };
      expect(fixture.componentInstance['source']()).toBe(expected);
      expect(fixture.componentInstance['error']()).toContain(prompts[expected]);
      if (source === undefined) {
        expect(fixture.componentInstance['error']()).toContain("Your setup answers aren't kept in the browser");
        expect(fixture.componentInstance['profileForm'].controls['name'].value).toBe('');
      }
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-questions"]')).toBeNull();
      expect(api.startForDocument).not.toHaveBeenCalled();
      TestBed.inject(HttpTestingController).expectNone(LINKEDIN_POST_INTAKE.endpoints.result);
    }
  );

  it('restores memory-only setup only on explicit document profile editing and saves only on explicit submit', async () => {
    api.setupForDocument.mockReturnValue({ ...profile.about, ...profile.voice });
    const params: Record<string, string> = { profile: 'edit', profileDocument: 'run-' + 'a'.repeat(24) };
    vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.queryParamMap, 'get').mockImplementation((key) => params[key] ?? null);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await render();
    expect(api.setupForDocument).toHaveBeenCalledWith('project-one', 'run-' + 'a'.repeat(24));
    expect(fixture.componentInstance['profileForm'].controls['name'].value).toBe(profile.about.name);
    expect(api.save).not.toHaveBeenCalled();
    fixture.componentInstance['onProfileSubmit']();
    expect(api.save).toHaveBeenCalledWith({ setup: expect.objectContaining({ name: profile.about.name }) });
    expect(api.startForDocument).not.toHaveBeenCalled();
    expect(fixture.componentInstance['explicitProfileSave']()).toBe(true);
    context.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance['explicitProfileSave']()).toBe(false);
  });
  it('warns about the content Drive URL without disabling drafting', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['saved'].set({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    component['editing'].set(false);
    component['source'].set('url');
    component['contentForm'].controls.url.setValue('https://drive.google.com/drive/folders/synthetic');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-link-warning"]')?.textContent).toContain(MKTG_INTAKE_LINK_ADVICE.drivePrivate);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-draft"] button')?.disabled).toBe(false);
    expect(component['contentForm'].valid).toBe(true);
    component['contentForm'].controls.url.setValue('https://project.example/article');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-link-warning"]')).toBeNull();
  });

  it('composes one breadcrumb with the main kit family route and catalog name', async () => {
    const fixture = await render();
    const family = MKTG_KIT_FAMILIES.find((family) => family.agentIds.includes(LINKEDIN_POST_INTAKE.agentId));
    if (!family) throw new Error('Expected a catalog family for the intake');
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(1);
    const link = element.querySelector('[data-testid="mktg-breadcrumb-link-1"]');
    expect(link?.textContent?.trim()).toBe(family.name);
    expect(link?.getAttribute('href')).toContain(`/families/${family.id}`);
  });
  it('uses fixed context parents on a shared run URL and the intake action title', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/linkedin-post?project=old&profile=edit&revision=old');
    const fixture = await render();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('[data-testid="mktg-breadcrumb-link-0"]')?.getAttribute('href')).toBe('/project/mktg-os-agents?project=example-project');
    expect(element.querySelector('[data-testid="mktg-breadcrumb-link-1"]')?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/families/social-community?project=example-project'
    );
    expect(element.querySelector('[aria-current="page"]')?.textContent).toBe('Draft a LinkedIn post');
  });
  it.each(['project', 'user'])('distinguishes a missing %s from a refused writer grant', async (missing) => {
    if (missing === 'project') context.set(null);
    else identity.set(null);
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-no-access"]')).toBeNull();
    if (missing === 'project') expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-error"]')?.textContent).toContain('Select a project');
    else {
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-error"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-loading"]')?.textContent).toContain('Checking the run…');
      expect(fixture.nativeElement.querySelector('form')).toBeNull();
    }
    expect(projects.getProject).not.toHaveBeenCalled();
  });
  it('reads writer access without changing the current project even if loading fails', async () => {
    projects.getProject.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const fixture = await render();
    expect(projects.getProject).toHaveBeenCalledWith('example-project', false);
    expect(context()?.uid).toBe('project-one');
    expect(fixture.componentInstance['error']()).toContain('could not be loaded');
  });
  it('keeps a selected file visible after editing, but clears it on a source switch', async () => {
    const fixture = await savedIntake();
    const component = fixture.componentInstance;
    component['onSource']('file');
    component['file'].set(new File(['Release'], 'synthetic-release.txt'));
    component['onEdit']();
    component['onCancelEdit']();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-selected-file"]').textContent).toContain('synthetic-release.txt');
    component['onSource']('text');
    component['onSource']('file');
    fixture.detectChanges();
    expect(component['file']()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-selected-file"]')).toBeNull();
    await component['onDraft']();
    expect(component['error']()).toContain('Choose a text file');
    expect(api.startForDocument).not.toHaveBeenCalled();
  });
  it.each(['missing', 'oversized'])('uses the configured byte limit for a %s file without reading or starting a run', async (kind) => {
    const component = (await savedIntake()).componentInstance;
    component['onSource']('file');
    if (kind === 'oversized') component['file'].set(new File([new Uint8Array(LINKEDIN_SOURCE_MAX_BYTES + 1)], 'synthetic.txt'));
    const read = (component['readFile'] = vi.fn());
    await component['onDraft']();
    expect(component['error']()).toBe(`Choose a text file up to ${LINKEDIN_SOURCE_MAX_BYTES.toLocaleString('en-US')} bytes.`);
    expect(read).not.toHaveBeenCalled();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });
  it('resets omitted optional fields when cancelled first-run profile edits reopen', async () => {
    const component = (await render()).componentInstance;
    component['profileForm'].patchValue({ name: 'Example author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' });
    component['onProfileSubmit']();
    component['onEdit']();
    component['profileForm'].patchValue({ tone: 'Cancelled tone' });
    component['onCancelEdit']();
    component['onEdit']();
    expect(component['profileForm'].get('tone')?.value).toBe('');
  });

  it('collects first-run questions, keeps defaults optional and does not save before a run', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    expect(fixture.nativeElement.textContent).toContain('Your role');
    component['profileForm'].patchValue({ ...profile.about });
    component['onProfileSubmit']();
    fixture.detectChanges();
    expect(component['setup']()?.name).toBe('Example author');
    expect(api.save).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Regenerate with feedback');
  });
  it('renders configured limits/file types and stable testids on native controls', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    const name = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-name"] input');
    expect(name.maxLength).toBe(LINKEDIN_PROFILE_MAX_FIELD_CHARS);
    component['profileForm'].patchValue({ ...profile.about });
    component['onProfileSubmit']();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-content-text"] textarea')).not.toBeNull();
    component['onSource']('file');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-linkedin-file"]').length).toBe(1);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-file"] input[type="file"]').accept).toBe(LINKEDIN_FILE_ACCEPT);
    expect(fixture.nativeElement.textContent).toContain(LINKEDIN_FILE_TYPES_LABEL);
  });
  it('edits a saved profile prefilled, saving without creating a document', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const fixture = await render();
    const component = fixture.componentInstance;
    component['onEdit']();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-cancel-edit"] button').click();
    expect(component['editing']()).toBe(false);
    component['onEdit']();
    expect(component['profileForm'].getRawValue()['tone']).toBe(profile.voice.tone);
    component['profileForm'].controls['tone'].setValue('direct');
    component['onProfileSubmit']();
    expect(api.save).toHaveBeenCalledWith({ setup: expect.objectContaining({ tone: 'direct' }) });
    expect(api.startForDocument).not.toHaveBeenCalled();
  });
  it('opens the saved personal profile in edit mode from the document link without running an agent', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const pending = intakePending('writing');
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.save(pending);
    const token = attempts.prepare(pending.request, true);
    const consume = vi.spyOn(attempts, 'consumeQuestions');
    vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.queryParamMap, 'get').mockImplementation((key) => {
      if (key === 'profile') return 'edit';
      return key === 'questions' ? token : null;
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await render();
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-form"]')).not.toBeNull();
    expect(fixture.componentInstance['profileForm'].controls['name'].value).toBe('Example author');
    expect(consume).not.toHaveBeenCalled();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('pushes profile editing, restores it from the URL, and cancels through browser history', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    const runUrl = '/project/mktg-os-agents/linkedin-post?project=example-project';
    await router.navigateByUrl(runUrl);
    const fixture = await render();
    fixture.componentInstance['onEdit']();
    await fixture.whenStable();
    expect(router.url).toContain('profile=edit');
    expect(fixture.componentInstance['editing']()).toBe(true);
    TestBed.inject(Location).back();
    await vi.waitFor(() => expect(router.url).toBe(runUrl));
    expect(fixture.componentInstance['editing']()).toBe(false);
    TestBed.inject(Location).forward();
    await vi.waitFor(() => expect(router.url).toContain('profile=edit'));
    expect(fixture.componentInstance['editing']()).toBe(true);
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    fixture.componentInstance['onCancelEdit']();
    expect(back).toHaveBeenCalledOnce();
  });

  it('saves an edit by returning to its pushed run entry, so the next Back leaves the run page', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    await router.navigateByUrl('/project/mktg-os-agents/families/social-community?project=example-project');
    const runUrl = '/project/mktg-os-agents/linkedin-post?project=example-project';
    await router.navigateByUrl(runUrl);
    const fixture = await render();
    const writes = vi.spyOn(router, 'navigate');
    fixture.componentInstance['onEdit']();
    await fixture.whenStable();
    expect(location.getState()).toMatchObject({ [LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY]: LINKEDIN_PROFILE_EDIT_ORIGINS.run });
    fixture.componentInstance['onProfileSubmit']();
    await vi.waitFor(() => expect(router.url).toBe(runUrl));
    await fixture.whenStable();
    expect(writes).toHaveBeenCalledOnce();
    location.back();
    await vi.waitFor(() => expect(router.url).toContain('/families/social-community'));
    await fixture.whenStable();
  });

  it.each(['cancel', 'save'] as const)('cold entry → Family → Back → %s clears profile in place', async (action) => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    const editUrl = '/project/mktg-os-agents/linkedin-post?project=example-project&profile=edit';
    await router.navigateByUrl(editUrl);
    let fixture = await render();
    await router.navigateByUrl('/project/mktg-os-agents/families/social-community?project=example-project');
    fixture.destroy();
    location.back();
    await vi.waitFor(() => expect(router.url).toBe(editUrl));
    fixture = await render();
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    const navigate = vi.spyOn(router, 'navigate');
    if (action === 'cancel') fixture.componentInstance['onCancelEdit']();
    else fixture.componentInstance['onProfileSubmit']();
    await fixture.whenStable();
    expect(back).not.toHaveBeenCalled();
    expect(router.url).toBe('/project/mktg-os-agents/linkedin-post?project=example-project');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true, queryParams: { profile: null, project: 'example-project' } }));
  });

  it.each(['cancel', 'save'] as const)('an in-app document hand-off returns to the document on %s', async (action) => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    const documentUrl = '/project/mktg-os-agents/documents/linkedin-post/synthetic?project=example-project';
    await router.navigateByUrl(documentUrl);
    await router.navigateByUrl('/project/mktg-os-agents/linkedin-post?project=example-project&profile=edit', {
      state: { [LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY]: LINKEDIN_PROFILE_EDIT_ORIGINS.document },
    });
    const fixture = await render();
    if (action === 'cancel') fixture.componentInstance['onCancelEdit']();
    else fixture.componentInstance['onProfileSubmit']();
    await vi.waitFor(() => expect(router.url).toBe(documentUrl));
    await fixture.whenStable();
  });

  it('setup → run-page Edit → Continue keeps answers and the next Back leaves intake', async () => {
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    await router.navigateByUrl('/project/mktg-os-agents/families/social-community?project=example-project');
    const runUrl = '/project/mktg-os-agents/linkedin-post?project=example-project';
    await router.navigateByUrl(runUrl);
    const fixture = await render();
    const component = fixture.componentInstance;
    component['profileForm'].patchValue({ ...profile.about });
    component['onProfileSubmit']();
    component['onEdit']();
    await fixture.whenStable();
    component['profileForm'].controls['tone'].setValue('direct');
    component['onProfileSubmit']();
    await vi.waitFor(() => expect(router.url).toBe(runUrl));
    expect(component['setup']()?.tone).toBe('direct');
    expect(component['editing']()).toBe(false);
    location.back();
    await vi.waitFor(() => expect(router.url).toContain('/families/social-community'));
    expect(api.save).not.toHaveBeenCalled();
  });

  it.each([true, LINKEDIN_PROFILE_EDIT_ORIGINS.document])('keeps setup-only answers after a document edit (marker %s)', async (marker) => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/documents/linkedin-post/synthetic?project=example-project');
    await router.navigateByUrl('/project/mktg-os-agents/linkedin-post?project=example-project&profile=edit', {
      state: { [LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY]: marker },
    });
    const fixture = await render();
    const component = fixture.componentInstance;
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    component['profileForm'].patchValue({ ...profile.about, ...profile.voice });
    component['onProfileSubmit']();
    await fixture.whenStable();
    expect(back).not.toHaveBeenCalled();
    expect(router.url).toBe('/project/mktg-os-agents/linkedin-post?project=example-project');
    expect(component['setup']()).toMatchObject({
      name: profile.about.name,
      role: profile.about.role,
      focus_areas: profile.about.focus_areas,
      primary_audience: profile.about.primary_audience,
    });
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).not.toBeNull();
    expect(api.save).not.toHaveBeenCalled();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('loads a content source URL, pushes source switches and restores the prior source without another write', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    const path = '/project/mktg-os-agents/linkedin-post?project=example-project';
    await router.navigateByUrl(`${path}&source=url`);
    const fixture = await render();
    expect(fixture.componentInstance['source']()).toBe('url');
    fixture.componentInstance['onSource']('file');
    await fixture.whenStable();
    expect(router.url).toContain('source=file');
    await router.navigateByUrl(`${path}&source=url`);
    await fixture.whenStable();
    expect(fixture.componentInstance['source']()).toBe('url');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-content-url"]')).not.toBeNull();
    expect(api.startForDocument).not.toHaveBeenCalled();
  });
  it('prefills the share link from the URL source, preserves an edit, and clears it for other sources', async () => {
    const component = (await render()).componentInstance;
    component['onSource']('url');
    component['contentForm'].controls.url.setValue('https://public.example/source');
    expect(component['contentForm'].controls.share_link.value).toBe('https://public.example/source');
    component['contentForm'].controls.share_link.setValue('https://public.example/shared');
    component['contentForm'].controls.share_link.markAsDirty();
    component['contentForm'].controls.url.setValue('https://public.example/another-source');
    expect(component['contentForm'].controls.share_link.value).toBe('https://public.example/shared');
    component['onSource']('text');
    expect(component['contentForm'].controls.share_link.value).toBe('');
    component['onSource']('file');
    expect(component['contentForm'].controls.share_link.value).toBe('');
  });

  it('keeps a failed questions reply for retry instead of starting a fresh run', async () => {
    const component = (await questionsIntake()).componentInstance;
    component['onAnswers']([{ key: 'tendency', text: 'A clear, technical voice for maintainers.', origin: 'edited' }]);
    TestBed.inject(HttpTestingController)
      .expectOne(LINKEDIN_POST_INTAKE.endpoints.answers ?? '')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(component['questions']()).toHaveLength(1);
    expect(component['previousAnswers']()).toEqual({ tendency: 'A clear, technical voice for maintainers.' });
    expect(component['error']()).toContain('kept');
    expect(api.startForDocument).not.toHaveBeenCalled();
  });
  it('shows the safe stale-question server message and keeps the edited answers', async () => {
    const component = (await questionsIntake()).componentInstance;
    component['onAnswers']([{ key: 'tendency', text: 'A clear technical voice.', origin: 'edited' }]);
    TestBed.inject(HttpTestingController)
      .expectOne(LINKEDIN_POST_INTAKE.endpoints.answers ?? '')
      .flush({ error: 'These questions are no longer available. Reload the run.' }, { status: 400, statusText: 'Stale' });
    expect(component['error']()).toBe('These questions are no longer available. Reload the run.');
    expect(component['previousAnswers']()).toEqual({ tendency: 'A clear technical voice.' });
    expect(component['questions']()).toHaveLength(1);
    expect(api.startForDocument).not.toHaveBeenCalled();
  });

  it('shows the BFF source refusal so the user knows to paste text instead', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['editing'].set(false);
    component['contentForm'].controls.text.setValue('Example content');
    api.startForDocument.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              error: 'Validation failed for content',
              errors: [{ field: 'content', message: 'Could not fetch that public HTTPS page. Paste its text instead.' }],
            },
          })
      )
    );
    await component['onDraft']();
    expect(component['error']()).toContain('Paste its text instead.');
    expect(component['busy']()).toBe(false);
  });
  it('does not read the LinkedIn profile when project write access is denied', async () => {
    TestBed.overrideProvider(ProjectService, { useValue: { getProject: () => of({ writer: false }) } });
    const fixture = await render();
    expect(api.profile).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-no-access"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
  });
  it('renders a distinct load error, not an empty first-run profile', async () => {
    api.profile.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-retry-load"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-form"]')).toBeNull();
  });
});

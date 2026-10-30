// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  FOUNDATION_MESSAGE_CONTRACT_ID,
  FOUNDATION_MESSAGE_INTAKE,
  BRAND_KIT_INTAKE,
  BRAND_KIT_CONTRACT_ID,
  MKTG_AGENT_INTAKES,
  MKTG_DOCUMENT_TYPES,
  MKTG_RUN_POLL,
  MKTG_RUN_RESUME_QUERY_CLEAR,
} from '@lfx-one/shared/constants';
import {
  MktgGenerateRequest,
  MktgDocumentRunProgress,
  MktgRunPendingQuestions,
  MktgDependencyDocument,
  MktgRunQuestionsPending,
  MktgRunResultResponse,
  MktgRevisionResponse,
  MktgRevisionSummary,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { findMktgRunIntake } from '@lfx-one/shared/utils/mktg-document-store.utils';
import { returningRunFixture } from '@lfx-one/shared/utils/__fixtures__/mktg-returning-run.fixture';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgAnswerMemoryService } from '@services/mktg-answer-memory.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { provideMktgSlidesExportStub } from '@shared/testing/mktg-slides-export-test-service';
import { buildMktgRunActivity } from '@lfx-one/shared/utils/mktg-run-activity.utils';
import { provideMktgCommentsStub } from '@shared/testing/mktg-comments-test-service';
import { noQuestionsActivityPayloads } from '@lfx-one/shared/utils/__fixtures__/mktg-run-activity.no-questions';
import { MessageService } from 'primeng/api';
import { filter, firstValueFrom, NEVER, of, take } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgAgentRunComponent } from './mktg-agent-run/mktg-agent-run.component';
import { MktgDocumentViewComponent } from './mktg-document-view/mktg-document-view.component';

describe('Asset handoff through real nested Router, HTTP and run attempt services', () => {
  const project: ProjectContext = { uid: 'synthetic-project', slug: 'synthetic-orbit', name: 'Synthetic Orbit' };
  const intake = Object.values(MKTG_AGENT_INTAKES).find((candidate) => candidate.regenerateViaGenerate && !candidate.endpoints.answers);
  if (!intake) {
    throw new Error('Missing registered synthetic test target');
  }
  const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === intake.agentId);
  if (!type) {
    throw new Error('Missing registered document type');
  }
  const revisionId = `000001-${'a'.repeat(64)}`;
  const revision = {
    id: revisionId,
    number: 1,
    createdAt: '2026-10-19T08:00:00Z',
    origin: 'generated' as const,
    restoredFromNumber: null,
    intakeMode: 'form' as const,
    status: '',
    contentSha256: 'a'.repeat(64),
    format: 'markdown' as const,
    commentCount: 0,
    latest: true,
    author: null,
    approval: null,
  } satisfies MktgRevisionSummary;
  const stored: MktgRevisionResponse = {
    project: project.uid,
    type,
    documentId: 'living',
    revisions: [revision],
    revision,
    approval: null,
    approvedCurrent: null,
    markdown: '# Synthetic asset',
    sidecar: null,
    runs: [],
  };
  const request: MktgGenerateRequest = {
    projectUid: project.uid,
    agentId: intake.agentId,
    intake,
    answers: { project_name: project.name, github_url: 'https://github.com/synthetic-org/synthetic-orbit', business_outcome: 'Grow adoption' },
  };
  let dependencies: Record<string, MktgDependencyDocument | null>;
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;
  const query = (id: string) => harness.routeNativeElement?.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const navigation = () =>
    firstValueFrom(
      router.events.pipe(
        filter((event) => event instanceof NavigationEnd),
        take(1)
      )
    );
  const settle = async () => {
    await harness.fixture.whenStable();
    harness.detectChanges();
  };

  const flushRecordedRead = (agentKey: string, state: MktgDocumentRunProgress['state'] = 'writing', pendingQuestions?: MktgRunPendingQuestions) => {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentKey);
    if (!type) throw new Error('Missing recorded fixture type');
    const run: MktgDocumentRunProgress = {
      project: project.uid,
      agentKey: type.agentKey,
      documentId: 'living',
      runId: 'b'.repeat(64),
      state,
      startedAt: revision.createdAt,
      ...(pendingQuestions && { pendingQuestions }),
    };
    http
      .expectOne((candidate) => candidate.url.endsWith(`/documents/${agentKey}/living`) && candidate.params.get('run') === run.runId)
      .flush({ project: project.uid, type, documentId: 'living', revisions: [], approvedCurrent: null, runs: [run] });
  };

  beforeEach(async () => {
    dependencies = {};
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const activeContext = signal<ProjectContext | null>(project);
    await TestBed.configureTestingModule({
      providers: [
        provideMktgCommentsStub(),
        provideRouter(
          ['project', 'foundation'].map((lens) => ({
            path: `${lens}/mktg-os-agents`,
            children: [
              { path: 'documents/:agentKey/:documentId', component: MktgDocumentViewComponent },
              { path: ':agentId', component: MktgAgentRunComponent },
            ],
          }))
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        MessageService,
        provideMktgSlidesExportStub({ last: vi.fn(() => of({ last: null, latestRevision: null })), start: vi.fn(), poll: vi.fn() }),
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: computed(() => activeContext()?.uid ?? '') } },
        { provide: UserService, useValue: { user: signal({ sub: 'synthetic-owner' }), impersonating: signal(false) } },
        { provide: ProjectService, useValue: { getProject: () => of({ ...project, writer: true }) } },
        { provide: MktgAnswerMemoryService, useValue: { load: () => ({}), remember: vi.fn() } },
        {
          provide: MktgDependencyService,
          useValue: { resolveDependencies: () => of(dependencies), resolveBrandKit: () => of(null), notifyDocumentsChanged: vi.fn(), documentsChanged$: NEVER },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    // Run-page button wording reads the summary; this suite keeps document/revision HTTP real.
    vi.spyOn(TestBed.inject(MktgDocumentStoreService), 'listDocuments').mockReturnValue(of({ project: project.uid, groups: [] }));
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
  });
  afterEach(() => {
    harness?.fixture.destroy();
    http?.verify();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it.each(['project', 'foundation'])('fixed parent breadcrumbs do not carry fresh mode on the %s mount', async (lens) => {
    const target = FOUNDATION_MESSAGE_INTAKE;
    await harness.navigateByUrl(`/${lens}/mktg-os-agents/${target.agentId}?project=${project.slug}&mode=new`, MktgAgentRunComponent);
    await settle();
    http.expectOne((candidate) => candidate.url.endsWith('/intakes/foundation-message/last')).flush({ intake: null });
    await settle();
    for (const index of [0, 1]) {
      const href = query('mktg-breadcrumb-link-' + index)?.getAttribute('href');
      expect(href).toBeTruthy();
      const url = new URL(href ?? '', 'https://synthetic.example');
      expect(url.pathname).toContain(`/${lens}/mktg-os-agents`);
      expect(url.searchParams.has('mode')).toBe(false);
      expect(url.searchParams.get('project')).toBe(project.slug);
    }
    http.expectNone((candidate) => candidate.url.includes('/intakes/'));
    http.expectNone((candidate) => candidate.method === 'POST');
  });

  it.each(['project', 'foundation'])('a dependency link clears fresh mode on the %s mount', async (lens) => {
    const source = await harness.navigateByUrl(`/${lens}/mktg-os-agents/${BRAND_KIT_INTAKE.agentId}?project=${project.slug}&mode=new`, MktgAgentRunComponent);
    await settle();
    http.expectOne((candidate) => candidate.url.endsWith('/intakes/brand-kit/last')).flush({ intake: null });
    await settle();
    const landed = navigation();
    source['onOpenAgent'](FOUNDATION_MESSAGE_INTAKE.agentId);
    await landed;
    await settle();
    const url = new URL(router.url, 'https://synthetic.example');
    expect(url.pathname).toBe(`/${lens}/mktg-os-agents/${FOUNDATION_MESSAGE_INTAKE.agentId}`);
    expect(url.searchParams.has('mode')).toBe(false);
    expect(url.searchParams.get('project')).toBe(project.slug);
    http.expectNone((candidate) => candidate.url.includes('/intakes/'));
    http.expectNone((candidate) => candidate.method === 'POST');
  });

  it.each(MKTG_DOCUMENT_TYPES.filter((candidate) => !!findMktgRunIntake(candidate.agentKey)?.endpoints.result))(
    'reconnects $agentKey result polling after leaving the routed intake mid-run',
    async (target) => {
      const registered = findMktgRunIntake(target.agentKey);
      if (!registered) throw new Error('Missing registered result intake');
      const frameworkType = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === FOUNDATION_MESSAGE_INTAKE.agentId);
      if (!frameworkType) throw new Error('Missing registered framework dependency');
      const framework = returningRunFixture(frameworkType, project.uid);
      vi.spyOn(TestBed.inject(MktgDependencyService), 'resolveDependencies').mockReturnValue(
        of({
          [FOUNDATION_MESSAGE_INTAKE.agentId]: {
            agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
            source: 'server',
            version: 1,
            document: '# Synthetic framework',
            sidecar: { contract: FOUNDATION_MESSAGE_CONTRACT_ID, content: framework.result.asset?.content },
          },
        })
      );
      const component = await harness.navigateByUrl(`/project/mktg-os-agents/${registered.agentId}`, MktgAgentRunComponent);
      await settle();
      for (const field of registered.fields) {
        if (field.optional) continue;
        let value = 'Grow synthetic adoption';
        if (field.prefill === 'project-name') value = project.name;
        if (field.format === 'github-url' || field.format === 'github-repo-url') value = 'https://github.com/synthetic-org/synthetic-orbit';
        if (field.format && field.format !== 'github-url' && field.format !== 'github-repo-url') value = 'https://synthetic.example';
        component['intakeForm'].controls[field.key].setValue(value);
      }
      await settle();
      component['onSubmit']();
      await settle();
      http.expectOne(registered.endpoints.generate).flush({ sessionId: 'synthetic-session', ownerToken: 'synthetic-proof', runId: 'b'.repeat(64) });
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      const interrupted = http.expectOne(registered.endpoints.result);
      // Leave the owning route first: a direct-start intake may already be on its asset receiver.
      await harness.navigateByUrl(`/foundation/mktg-os-agents/${registered.agentId}`, MktgAgentRunComponent);
      expect(interrupted.cancelled).toBe(true);
      const scopeReads = http.match((candidate) => candidate.url.endsWith(`/documents/${target.agentKey}/living`));
      // The new route also re-reads the exact run before it may resume the private session.
      expect(scopeReads.filter((read) => !read.cancelled)).toHaveLength(1);
      scopeReads.forEach((read) => {
        if (read.cancelled) expect(read.cancelled).toBe(true);
        else {
          expect(read.request.params.get('run')).toBe('b'.repeat(64));
          read.flush({
            project: project.uid,
            type: target,
            documentId: 'living',
            revisions: [],
            runs: [
              { project: project.uid, agentKey: target.agentKey, documentId: 'living', runId: 'b'.repeat(64), state: 'writing', startedAt: revision.createdAt },
            ],
          });
        }
      });
      await harness.navigateByUrl(`/project/mktg-os-agents/documents/${target.agentKey}/living?run=${'b'.repeat(64)}`, MktgDocumentViewComponent);
      await settle();
      http
        .expectOne((candidate) => candidate.url.endsWith(`/documents/${target.agentKey}/living`))
        .flush({
          project: project.uid,
          type: target,
          documentId: 'living',
          revisions: [],
          runs: [
            { project: project.uid, agentKey: target.agentKey, documentId: 'living', runId: 'b'.repeat(64), state: 'writing', startedAt: revision.createdAt },
          ],
        });
      await settle();
      http
        .expectOne((candidate) => candidate.url.endsWith(`/documents/${target.agentKey}/living`) && candidate.params.get('run') === 'b'.repeat(64))
        .flush({
          project: project.uid,
          type: target,
          documentId: 'living',
          revisions: [],
          runs: [
            { project: project.uid, agentKey: target.agentKey, documentId: 'living', runId: 'b'.repeat(64), state: 'writing', startedAt: revision.createdAt },
          ],
        });
      await settle();
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      const resumed = http.expectOne(registered.endpoints.result);
      expect(resumed.request.body).toMatchObject({ sessionId: 'synthetic-session', ownerToken: 'synthetic-proof', project: project.uid });
      const landed = navigation();
      const fixture = returningRunFixture(target, project.uid);
      resumed.flush(fixture.result);
      await landed;
      await settle();
      const result = fixture.revision;
      http.match((candidate) => candidate.url.endsWith(`/documents/${target.agentKey}/living`)).forEach((read) => read.flush(result));
      http.expectOne((candidate) => candidate.url.endsWith(`/revisions/${revisionId}`)).flush(result);
      await settle();
      http.match((candidate) => candidate.url.endsWith('/slides-export/last')).forEach((read) => read.flush({ last: null, latestRevision: null }));

      expect(router.url).toContain(`revision=${revisionId}`);
      expect(query(fixture.selector)).not.toBeNull();
      expect(query('mktg-document-view-unsupported-asset')).toBeNull();
      expect(query('mktg-document-view-run')).toBeNull();
      http.expectNone(registered.endpoints.generate);
    }
  );

  it('waits through unavailable metadata then transfers the accepted poll to the run page without Generate', async () => {
    TestBed.inject(MktgRunAttemptService).save({
      request,
      state: 'writing',
      updatedAt: new Date().toISOString(),
      attempt: {
        session: { agentId: intake.agentId, sessionId: 'synthetic-waiting-session', ownerToken: 'synthetic-waiting-proof' },
        runId: 'b'.repeat(64),
        priorVersion: 0,
      },
    });
    const resume = vi.spyOn(TestBed.inject(MktgAgentRunService), 'resume');
    await harness.navigateByUrl(`/project/mktg-os-agents/documents/${type.agentKey}/living?run=${'b'.repeat(64)}`, MktgDocumentViewComponent);
    await settle();
    const unavailable = { project: project.uid, type, documentId: 'living', revisions: [], approvedCurrent: null, runs: [], progressUnavailable: true };
    http.expectOne((candidate) => candidate.url.endsWith(`/documents/${type.agentKey}/living`)).flush(unavailable);
    await settle();
    expect(resume).not.toHaveBeenCalled();
    http.expectNone(intake.endpoints.result);
    http.expectNone(intake.endpoints.generate);
    await vi.advanceTimersByTimeAsync(2 * MKTG_RUN_POLL.intervalMs);
    http
      .expectOne((candidate) => candidate.url.endsWith(`/documents/${type.agentKey}/living`))
      .flush({
        ...unavailable,
        progressUnavailable: false,
        runs: [{ project: project.uid, agentKey: type.agentKey, documentId: 'living', runId: 'b'.repeat(64), state: 'writing', startedAt: revision.createdAt }],
      });
    await settle();
    // The destination re-observes the server before resuming the same accepted session.
    http
      .expectOne((candidate) => candidate.url.endsWith(`/documents/${type.agentKey}/living`) && candidate.params.get('run') === 'b'.repeat(64))
      .flush({
        ...unavailable,
        progressUnavailable: false,
        runs: [{ project: project.uid, agentKey: type.agentKey, documentId: 'living', runId: 'b'.repeat(64), state: 'writing', startedAt: revision.createdAt }],
      });
    await settle();
    // The headless document observer reconnects, then the active-run redirect
    // cancels that reader and the run-page owner resumes the same accepted session.
    expect(resume).toHaveBeenCalledTimes(2);
    expect(router.url.split('?')[0]).toBe(`/project/mktg-os-agents/${intake.agentId}`);
    expect(query('mktg-document-view-run')).toBeNull();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    const poll = http.expectOne(intake.endpoints.result);
    expect(poll.request.body).toMatchObject({
      sessionId: 'synthetic-waiting-session',
      ownerToken: 'synthetic-waiting-proof',
      project: project.uid,
    });
    poll.flush({ status: 'pending' });
    await settle();
    expect(resume).toHaveBeenCalledTimes(2);
    expect(query('mktg-run-progress-status')?.textContent).toContain('You can leave this page');
    http.expectNone(intake.endpoints.generate);
  });

  it.each([
    { label: 'no local attempt', local: 'none', publicState: 'writing', selection: '' },
    { label: 'saved draft', local: 'draft', publicState: 'writing', selection: '' },
    { label: 'saved questions', local: 'questions', publicState: 'writing', selection: '' },
    { label: 'saved failure', local: 'failed', publicState: 'writing', selection: '' },
    { label: 'public failure with stale local writing', local: 'writing', publicState: 'failed', selection: '' },
    { label: 'public questions with stale local writing', local: 'writing', publicState: 'questions', selection: '' },
    { label: 'missing public attempt', local: 'writing', publicState: 'missing', selection: '' },
    { label: 'another selected run', local: 'writing', publicState: 'writing', selection: `?run=${'c'.repeat(64)}` },
    { label: 'pinned revision', local: 'writing', publicState: 'writing', selection: `?revision=${revisionId}` },
  ] as const)('does not reconnect creator polling for $label', async ({ local, publicState, selection }) => {
    if (local !== 'none')
      TestBed.inject(MktgRunAttemptService).save({
        request,
        state: local,
        updatedAt: new Date().toISOString(),
        attempt: {
          session: { agentId: intake.agentId, sessionId: 'synthetic-session', ownerToken: 'synthetic-proof' },
          runId: 'b'.repeat(64),
          priorVersion: 0,
        },
      });
    await harness.navigateByUrl(`/project/mktg-os-agents/documents/${type.agentKey}/living${selection}`, MktgDocumentViewComponent);
    await settle();
    http
      .match((candidate) => candidate.url.includes('/documents/'))
      .forEach((read) =>
        read.flush({
          ...stored,
          runs:
            publicState === 'missing'
              ? []
              : [
                  {
                    project: project.uid,
                    agentKey: type.agentKey,
                    documentId: 'living',
                    runId: 'b'.repeat(64),
                    state: publicState,
                    startedAt: revision.createdAt,
                  },
                ],
        })
      );
    await settle();
    http.match((candidate) => candidate.url.includes('/documents/')).forEach((read) => read.flush(stored));
    await settle();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    http.expectNone((candidate) => candidate.method === 'POST');
    http.match((candidate) => candidate.url.includes('/documents/')).forEach((read) => read.flush(stored));
    await settle();
  });

  it.each(['project', 'foundation'])('lands a recorded failure on the %s document card after checking', async (lens) => {
    const frameworkType = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === FOUNDATION_MESSAGE_INTAKE.agentId);
    if (!frameworkType) throw new Error('Missing registered framework fixture');
    const req: MktgGenerateRequest = { ...request, agentId: FOUNDATION_MESSAGE_INTAKE.agentId, intake: FOUNDATION_MESSAGE_INTAKE };
    const attempts = TestBed.inject(MktgRunAttemptService);
    // Local progress is stale; only the server knows this attempt failed yet.
    attempts.save({
      request: req,
      state: 'writing',
      attempt: {
        session: { agentId: req.agentId, sessionId: 'synthetic-failed-session', ownerToken: 'synthetic-proof' },
        priorVersion: 0,
        runId: 'b'.repeat(64),
      },
      updatedAt: new Date().toISOString(),
    });
    const failure = 'Synthetic failure after checking: provide the missing evidence.';
    const failedDetail = {
      project: project.uid,
      type: frameworkType,
      documentId: 'living',
      revisions: [],
      runs: [
        {
          project: project.uid,
          agentKey: frameworkType.agentKey,
          documentId: 'living',
          runId: 'b'.repeat(64),
          state: 'failed',
          startedAt: '2026-10-20T10:00:00Z',
          failureText: failure,
        },
      ],
    };
    const navigate = vi.spyOn(router, 'navigate');
    await harness.navigateByUrl(`/${lens}/mktg-os-agents/${req.agentId}?run=${'b'.repeat(64)}`, MktgAgentRunComponent);
    await settle();
    // Each receiver reads canonical metadata, then refreshes this failed record exactly once.
    http
      .expectOne((candidate) => candidate.url.endsWith(`/documents/${frameworkType.agentKey}/living`) && !candidate.params.has('refreshRun'))
      .flush(failedDetail);
    await settle();
    const landed = navigation();
    http
      .expectOne(
        (candidate) =>
          candidate.url.endsWith(`/documents/${frameworkType.agentKey}/living`) &&
          candidate.params.get('refreshRun') === 'b'.repeat(64) &&
          candidate.params.get('run') === 'b'.repeat(64)
      )
      .flush(failedDetail);
    await landed;
    await settle();
    expect(attempts.load(project.uid, req.agentId)?.state).toBe('failed');
    expect(router.url).toContain(`/${lens}/mktg-os-agents/documents/${frameworkType.agentKey}/living?`);
    expect(router.url).toContain(`run=${'b'.repeat(64)}`);
    expect(query('mktg-agent-run-form')).toBeNull();
    http
      .expectOne((candidate) => candidate.url.endsWith(`/documents/${frameworkType.agentKey}/living`) && !candidate.params.has('refreshRun'))
      .flush(failedDetail);
    await settle();
    http
      .expectOne(
        (candidate) =>
          candidate.url.endsWith(`/documents/${frameworkType.agentKey}/living`) &&
          candidate.params.get('refreshRun') === 'b'.repeat(64) &&
          candidate.params.get('run') === 'b'.repeat(64)
      )
      .flush(failedDetail);
    await settle();
    expect(query('mktg-document-view-run')).not.toBeNull();
    expect(query('mktg-document-view-failure-details')?.textContent).toContain(failure);
    expect(navigate).toHaveBeenCalledTimes(1); // Canonical failure lands directly, never via a stale private-result detour.
    http.expectNone(req.intake.endpoints.result);
    http.expectNone(req.intake.endpoints.generate);
    http.expectNone((candidate) => candidate.method === 'POST');
  });

  it.each(['project', 'foundation'])('consumes one prepared generation on the %s mount and opens its exact receipt revision', async (lens) => {
    const token = TestBed.inject(MktgRunAttemptService).prepare(request);
    await harness.navigateByUrl(`/${lens}/mktg-os-agents/documents/${type.agentKey}/living?generation=${token}`, MktgDocumentViewComponent);
    await settle();
    const generate = http.expectOne(intake.endpoints.generate);
    expect(generate.request.method).toBe('POST');
    expect(generate.request.body.project).toBe(project.uid);
    generate.flush({ sessionId: 'synthetic-session', ownerToken: 'synthetic-owner-proof', runId: 'b'.repeat(64) });
    http
      .expectOne((candidate) => candidate.url.endsWith(`/documents/${type.agentKey}/living`))
      .flush({
        project: project.uid,
        type,
        documentId: 'living',
        revisions: [],
        runs: [
          { project: project.uid, agentKey: type.agentKey, documentId: 'living', runId: 'b'.repeat(64), state: 'writing', startedAt: '2026-10-19T08:00:00Z' },
        ],
      });
    await settle();
    // A recorded accepted token transfers to its run receiver, which confirms the exact run before result polling.
    expect(query('mktg-document-view-run')).toBeNull();
    expect(router.url.split('?')[0]).toBe(`/${lens}/mktg-os-agents/${intake.agentId}`);
    flushRecordedRead(type.agentKey);
    await settle();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    const landed = navigation();
    http.expectOne(intake.endpoints.result).flush({
      status: 'ready',
      version: 1,
      documentMarkdown: '# Synthetic asset',
      persistence: {
        project: project.uid,
        content_sha256: 'a'.repeat(64),
        document_location: { agent_key: type.agentKey, document_id: 'living', revision_id: revisionId },
      },
    });
    await landed;
    await settle();
    http.match((candidate) => candidate.url.endsWith(`/documents/${type.agentKey}/living`)).forEach((read) => read.flush(stored));
    await settle();
    http.expectOne((candidate) => candidate.url.endsWith(`/revisions/${revisionId}`)).flush(stored);
    await settle();
    expect(router.url).toContain(`revision=${revisionId}`);
    expect(query('mktg-document-view-document')?.textContent).toContain('Synthetic asset');
    http.expectNone(intake.endpoints.generate);
  });

  it.each(['project', 'foundation'])('restores saved intake on the %s document route without any automatic Generate', async (lens) => {
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.save({ request, state: 'failed', requiresReattachment: true, updatedAt: new Date().toISOString() });
    const token = attempts.prepare(request, true);
    const intakePath = `/${lens}/mktg-os-agents/${intake.agentId}`;
    const returned = firstValueFrom(
      router.events.pipe(
        filter((event) => event instanceof NavigationEnd && event.urlAfterRedirects.split('?')[0] === intakePath),
        take(1)
      )
    );
    await harness.navigateByUrl(`/${lens}/mktg-os-agents/documents/${type.agentKey}/living?generation=${token}`);
    await returned;
    await settle();
    // Restored input is not a document: no intermediate placeholder/action click or document 404 is needed.
    http.match((candidate) => candidate.url.endsWith(`/documents/${type.agentKey}/living`)).forEach((read) => expect(read.cancelled).toBe(true));
    expect(router.url.split('?')[0]).toBe(intakePath);
    expect(new URL(router.url, 'https://synthetic.example').searchParams.has('generation')).toBe(false);
    expect(query('mktg-document-view-page')).toBeNull();
    http.expectNone(intake.endpoints.generate);
    http.expectNone(intake.endpoints.result);
    http
      .expectOne((candidate) => candidate.url.endsWith(`/intakes/${type.agentKey}/last`))
      .flush({
        intake: { answers: Object.fromEntries(intake.fields.map((field) => [field.key, request.answers[field.key] ?? ''])), documentCount: 0, logoCount: 0 },
      });
    await settle();
    expect(query('mktg-run-sources')).not.toBeNull();
    expect(query('mktg-run-sources')?.textContent).toContain('From last time');
    expect(attempts.load(project.uid, intake.agentId)?.request.answers).toEqual(request.answers);
    const form = harness.routeDebugElement?.componentInstance as MktgAgentRunComponent;
    for (const field of intake.fields) expect(form['intakeForm'].controls[field.key].value).toBe(request.answers[field.key] ?? '');
    http.expectNone(intake.endpoints.generate);
    http.expectNone(intake.endpoints.result);
  });

  it.each(['project', 'foundation'])('Run again reaches the intake, not a child of Documents, on the %s mount', async (lens) => {
    await harness.navigateByUrl(`/${lens}/mktg-os-agents/documents/${type.agentKey}/living`, MktgDocumentViewComponent);
    await settle();
    http.expectOne((candidate) => candidate.url.endsWith(`/documents/${type.agentKey}/living`)).flush(stored);
    await settle();
    http.expectOne((candidate) => candidate.url.endsWith(`/revisions/${revisionId}`)).flush(stored);
    await settle();
    const returned = navigation();
    query('mktg-document-view-run-again')?.click();
    await returned;
    await settle();
    expect(router.url.split('?')[0]).toBe(`/${lens}/mktg-os-agents/${intake.agentId}`);
    expect(new URL(router.url, 'https://synthetic.example').searchParams.get('mode')).toBe('new');
    http
      .expectOne((candidate) => candidate.url.endsWith(`/intakes/${type.agentKey}/last`))
      .flush({
        intake: { answers: Object.fromEntries(intake.fields.map((field) => [field.key, request.answers[field.key] ?? ''])), documentCount: 0, logoCount: 0 },
      });
    await settle();
    expect(query('mktg-run-sources')).not.toBeNull();
    http.expectNone(intake.endpoints.generate);
    http.expectNone(intake.endpoints.result);
    expect(query('mktg-agent-run-page')).not.toBeNull();
  });

  it.each(['project', 'foundation'])('cancels an owned attempt re-check on the %s intake route before a late outcome can navigate', async (lens) => {
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.save({
      request,
      state: 'writing',
      attempt: {
        session: { agentId: request.agentId, sessionId: 'synthetic-owned-session', ownerToken: 'synthetic-owner-proof' },
        runId: 'b'.repeat(64),
        priorVersion: 0,
      },
      updatedAt: new Date().toISOString(),
    });
    const token = attempts.prepare(request, true);
    const navigate = vi.spyOn(router, 'navigate');
    const component = await harness.navigateByUrl(`/${lens}/mktg-os-agents/${intake.agentId}?questions=${token}`, MktgAgentRunComponent);
    await settle();
    flushRecordedRead(type.agentKey);
    await settle();
    expect(component['phase']()).toBe('running');
    expect(query('mktg-agent-run-form')).toBeNull();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    const poll = http.expectOne(intake.endpoints.result);
    http.expectNone((candidate) => candidate.method === 'POST');
    const calls = navigate.mock.calls.length;
    harness.fixture.destroy();
    expect(poll.cancelled).toBe(true);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(navigate).toHaveBeenCalledTimes(calls);
  });

  it.each(['project', 'foundation'])('restores the answered writing stretch and logs a safe re-check failure on the %s intake route', async (lens) => {
    const attempts = TestBed.inject(MktgRunAttemptService);
    const ownedRequest = { ...request, agentId: FOUNDATION_MESSAGE_INTAKE.agentId, intake: FOUNDATION_MESSAGE_INTAKE };
    attempts.save({
      request: ownedRequest,
      state: 'writing',
      attempt: {
        session: { agentId: ownedRequest.agentId, sessionId: 'synthetic-session', ownerToken: 'SYNTHETIC_PRIVATE_PROOF' },
        runId: 'b'.repeat(64),
        priorVersion: 0,
      },
      answered: {
        questionsId: 'synthetic-answered-block',
        questions: [{ key: 'goal', label: 'Goal', question: 'Which synthetic goal?', why: '', suggestedAnswer: 'Adoption', basis: [] }],
        answers: [{ key: 'goal', text: 'Adoption', origin: 'accepted' }],
      },
      updatedAt: new Date().toISOString(),
    });
    const token = attempts.prepare(ownedRequest, true);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const component = await harness.navigateByUrl(`/${lens}/mktg-os-agents/${ownedRequest.agentId}?questions=${token}`, MktgAgentRunComponent);
      await settle();
      const ownedType = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === ownedRequest.agentId);
      if (!ownedType) throw new Error('Missing recorded framework fixture');
      flushRecordedRead(ownedType.agentKey);
      await settle();
      expect(component['writingStretch']()).toBe(true);
      expect(component['activityTitle']()).toBe('Checking recorded run progress…');
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      http.expectOne(ownedRequest.intake.endpoints.result).flush({}, { status: 400, statusText: 'Synthetic invalid request' });
      await settle();
      expect(log).toHaveBeenCalledWith('Failed to re-check Marketing OS run', { status: 400 });
      expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_PROOF');
      expect(component['phase']()).toBe('form');
      http.expectNone((candidate) => candidate.method === 'POST');
    } finally {
      log.mockRestore();
    }
  });

  it.each(['project', 'foundation'])('keeps a receipt-less ready result on the %s run route without another Generate', async (lens) => {
    const kitType = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === BRAND_KIT_INTAKE.agentId);
    if (!kitType) throw new Error('Missing registered kit fixture');
    dependencies[FOUNDATION_MESSAGE_INTAKE.agentId] = {
      agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
      source: 'server',
      version: 1,
      document: '# Synthetic framework',
      sidecar: {
        contract: 'messaging-document-output/v1',
        fields: { 'md.tagline': { value: 'Open, together', source: 'Synthetic source', status: 'approved' } },
      },
    };
    const component = await harness.navigateByUrl(`/${lens}/mktg-os-agents/${BRAND_KIT_INTAKE.agentId}`, MktgAgentRunComponent);
    await settle();
    component['intakeForm'].patchValue({ project_name: project.name, website_url: 'https://synthetic.example' });
    await settle();
    component['onSubmit']();
    await settle();
    http.expectOne(BRAND_KIT_INTAKE.endpoints.generate).flush({ sessionId: 'synthetic-ready-session', ownerToken: 'synthetic-proof', runId: 'b'.repeat(64) });
    await settle();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    const ready: MktgRunResultResponse = { status: 'ready', version: 1, documentMarkdown: '# Synthetic early kit', brandKit: brandKitTestRevision() };
    http.expectOne(BRAND_KIT_INTAKE.endpoints.result).flush(ready);
    await settle();
    expect(router.url.split('?')[0]).toBe(`/${lens}/mktg-os-agents/${BRAND_KIT_INTAKE.agentId}`);
    expect(query('mktg-document-view-run')).toBeNull();
    expect(component['writingStretch']()).toBe(true);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    http.expectOne(BRAND_KIT_INTAKE.endpoints.result).flush(ready);
    await settle();
    expect(query('mktg-run-activity')).not.toBeNull();
    http.expectNone((candidate) => candidate.url.includes('/documents/'));
    expect(router.url).not.toContain('revision=');
    expect(TestBed.inject(MktgAgentRunService).loadRun(project.uid, BRAND_KIT_INTAKE.agentId)?.versions).toHaveLength(1);
    http.expectNone(BRAND_KIT_INTAKE.endpoints.generate);
  });

  it.each(['project', 'foundation'])('keeps Brand Kit research and writing on the %s run route until its revision is stored', async (lens) => {
    const kitType = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === BRAND_KIT_INTAKE.agentId);
    if (!kitType) throw new Error('Missing synthetic Brand Kit type');
    dependencies[FOUNDATION_MESSAGE_INTAKE.agentId] = {
      agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
      source: 'server',
      version: 1,
      document: '# Synthetic framework',
      sidecar: {
        contract: 'messaging-document-output/v1',
        fields: { 'md.tagline': { value: 'Open, together', source: 'Synthetic source', status: 'approved' } },
      },
    };
    const component = await harness.navigateByUrl(`/${lens}/mktg-os-agents/${BRAND_KIT_INTAKE.agentId}`, MktgAgentRunComponent);
    await settle();
    component['intakeForm'].patchValue({ project_name: project.name, website_url: 'https://synthetic.example' });
    await settle();
    component['onSubmit']();
    await settle();
    http.expectOne(BRAND_KIT_INTAKE.endpoints.generate).flush({ sessionId: 'synthetic-kit-session', ownerToken: 'synthetic-proof', runId: 'b'.repeat(64) });
    await settle();
    expect(router.url).not.toContain('/documents/');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    const research = buildMktgRunActivity(noQuestionsActivityPayloads('research', true));
    expect(research.some((step) => step.kind === 'writing')).toBe(false);
    http.expectOne(BRAND_KIT_INTAKE.endpoints.result).flush({ status: 'pending', activity: research });
    await settle();
    expect(query('mktg-agent-run-page')?.textContent).toContain(research.find((step) => step.kind === 'search')?.label);
    for (const phase of ['between-rounds', 'writing'] as const) {
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      const activity = buildMktgRunActivity(noQuestionsActivityPayloads(phase, true));
      expect(activity.some((step) => step.kind === 'writing' || step.kind === 'checking')).toBe(false);
      http.expectOne(BRAND_KIT_INTAKE.endpoints.result).flush({ status: 'pending', activity });
      await settle();
      expect(router.url).not.toContain('/documents/');
      expect(component['writingStretch']()).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    const writing = buildMktgRunActivity(noQuestionsActivityPayloads('checked', true));
    expect(writing.some((step) => step.kind === 'checking')).toBe(true);
    const writingStep = writing.find((step) => step.kind === 'writing');
    if (!writingStep) throw new Error('Real activity producer did not emit no-questions writing');
    http.expectOne(BRAND_KIT_INTAKE.endpoints.result).flush({ status: 'pending', activity: writing });
    await settle();
    expect(router.url.split('?')[0]).toBe(`/${lens}/mktg-os-agents/${BRAND_KIT_INTAKE.agentId}`);
    expect(component['writingStretch']()).toBe(true);
    expect(query('mktg-run-activity')?.textContent).toContain(writingStep.label);
    expect(query('mktg-document-view-run')).toBeNull();
    http.expectNone((candidate) => candidate.url.includes('/documents/'));
    http.expectNone((candidate) => candidate.method === 'POST');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    const ready = navigation();
    const kit = brandKitTestRevision();
    http.expectOne(BRAND_KIT_INTAKE.endpoints.result).flush({
      status: 'ready',
      version: 1,
      documentMarkdown: '# Synthetic kit',
      activity: buildMktgRunActivity(noQuestionsActivityPayloads('checked', true)),
      brandKit: kit,
      persistence: {
        project: project.uid,
        version: 1,
        s3_key: 'synthetic-kit.md',
        content_sha256: 'a'.repeat(64),
        document_location: { agent_key: kitType.agentKey, document_id: 'living', revision_id: revisionId },
      },
    });
    await ready;
    await settle();
    http
      .expectOne((candidate) => candidate.url.endsWith(`/revisions/${revisionId}`))
      .flush({
        ...stored,
        type: kitType,
        revisions: [{ ...revision, format: 'json' }],
        revision: { ...revision, format: 'json' },
        markdown: JSON.stringify(kit.kit),
        sidecar: {
          contract: BRAND_KIT_CONTRACT_ID,
          project_name: kit.projectName,
          project: project.uid,
          version: kit.version,
          mode: kit.mode,
          kit: kit.kit,
          chapters: kit.chapters,
          report: kit.report,
          inputs: { website_url: kit.websiteUrl },
          generated_at: kit.generatedAt,
          agent: { agent_version: kit.agentVersion },
        },
      });
    await settle();
    expect(query('mktg-document-view-brand-kit')).not.toBeNull();
    expect(router.url).toContain('revision=' + revisionId);
    http.expectNone((candidate) => candidate.method === 'POST');
  });

  it.each(['project', 'foundation'])('redirects public questions to the %s run page and restores the browser-owned answers', async (lens) => {
    const frameworkType = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === FOUNDATION_MESSAGE_INTAKE.agentId);
    if (!frameworkType) throw new Error('Missing synthetic framework type');
    const req: MktgGenerateRequest = { ...request, agentId: FOUNDATION_MESSAGE_INTAKE.agentId, intake: FOUNDATION_MESSAGE_INTAKE };
    const pending: MktgRunQuestionsPending = {
      attempt: { session: { agentId: req.agentId, sessionId: 'synthetic-session', ownerToken: 'synthetic-proof' }, priorVersion: 0, runId: 'b'.repeat(64) },
      questionsId: 'a1234567',
      questions: [{ key: 'goal', label: 'Goal', question: 'Which synthetic goal?', why: '', suggestedAnswer: 'Adoption', basis: [] }],
    };
    TestBed.inject(MktgRunAttemptService).save({
      request: req,
      state: 'questions',
      attempt: pending.attempt,
      pendingQuestions: pending,
      updatedAt: new Date().toISOString(),
    });
    await harness.navigateByUrl(`/${lens}/mktg-os-agents/documents/${frameworkType.agentKey}/living?run=${'b'.repeat(64)}&mode=new`, MktgDocumentViewComponent);
    const navigate = vi.spyOn(router, 'navigate');
    await settle();
    http
      .expectOne((candidate) => candidate.url.endsWith(`/documents/${frameworkType.agentKey}/living`))
      .flush({
        project: project.uid,
        type: frameworkType,
        documentId: 'living',
        revisions: [],
        runs: [
          {
            project: project.uid,
            agentKey: frameworkType.agentKey,
            documentId: 'living',
            runId: 'b'.repeat(64),
            state: 'questions',
            startedAt: '2026-10-19T08:00:00Z',
            pendingQuestions: { questionsId: pending.questionsId, questions: pending.questions, askedAt: '2026-10-19T08:00:00Z' },
          },
        ],
      });
    await settle();
    flushRecordedRead(frameworkType.agentKey, 'questions', { questionsId: pending.questionsId, questions: pending.questions, askedAt: revision.createdAt });
    await settle();
    expect(router.url.split('?')[0]).toBe(`/${lens}/mktg-os-agents/${req.agentId}`);
    expect(query('mktg-document-view-run')).toBeNull();
    expect(router.url).toContain(`run=${'b'.repeat(64)}`);
    expect(new URL(router.url, 'https://synthetic.example').searchParams.has('mode')).toBe(false);
    expect(navigate).toHaveBeenCalledWith(
      [`/${lens}/mktg-os-agents`, req.agentId],
      expect.objectContaining({ queryParams: { project: project.slug, ...MKTG_RUN_RESUME_QUERY_CLEAR, run: 'b'.repeat(64) }, replaceUrl: true })
    );
    expect(query('mktg-agent-run-questions')?.textContent).toContain('Which synthetic goal?');
    http.expectNone((candidate) => candidate.method === 'POST');
  });

  it.each(
    MKTG_DOCUMENT_TYPES.filter((candidate) => !!findMktgRunIntake(candidate.agentKey)?.endpoints.answers).flatMap((target) =>
      ['project', 'foundation'].map((lens) => ({ target, lens }))
    )
  )('returns $target.agentKey questions on the $lens mount without another answers POST', async ({ target, lens }) => {
    const registered = findMktgRunIntake(target.agentKey);
    if (!registered) {
      throw new Error('Missing registered questions intake');
    }
    const req: MktgGenerateRequest = { ...request, agentId: registered.agentId, intake: registered };
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.save({
      request: req,
      state: 'writing',
      attempt: {
        session: { agentId: req.agentId, sessionId: 'synthetic-framework-session', ownerToken: 'synthetic-proof' },
        runId: 'b'.repeat(64),
        priorVersion: 0,
      },
      answered: { questions: [], answers: [], questionsId: 'a1234567' },
      updatedAt: new Date().toISOString(),
    });
    const token = attempts.prepare(req, true);
    const navigate = vi.spyOn(router, 'navigate');
    await harness.navigateByUrl(`/${lens}/mktg-os-agents/documents/${target.agentKey}/living?generation=${token}&mode=new`, MktgDocumentViewComponent);
    await settle();
    flushRecordedRead(target.agentKey);
    await settle();
    flushRecordedRead(target.agentKey);
    await settle();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    http.expectOne(req.intake.endpoints.result).flush({
      status: 'questions',
      questionsId: 'b1234567',
      questions: [{ key: 'goal', label: 'Goal', question: 'Which goal?', why: '', suggestedAnswer: 'Adoption', basis: [] }],
    });
    await settle();
    expect(query('mktg-agent-run-questions')).toBeNull();
    flushRecordedRead(target.agentKey, 'questions', {
      questionsId: 'b1234567',
      questions: [{ key: 'goal', label: 'Goal', question: 'Which goal?', why: '', suggestedAnswer: 'Adoption', basis: [] }],
      askedAt: revision.createdAt,
    });
    await settle();
    expect(router.url).toContain(`/${lens}/mktg-os-agents/${req.agentId}?`);
    expect(router.url).toContain(`run=${'b'.repeat(64)}`);
    expect(new URL(router.url, 'https://synthetic.example').searchParams.has('mode')).toBe(false);
    expect(navigate).toHaveBeenCalledWith(
      [`/${lens}/mktg-os-agents`, req.agentId],
      expect.objectContaining({ queryParams: { project: project.slug, ...MKTG_RUN_RESUME_QUERY_CLEAR, run: 'b'.repeat(64) }, replaceUrl: true })
    );
    expect(query('mktg-agent-run-questions')?.textContent).toContain('Which goal?');
    http.expectNone(req.intake.endpoints.answers ?? 'no-answers-endpoint');
    http.expectNone(req.intake.endpoints.generate);
  });
});

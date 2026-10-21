// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FOUNDATION_MESSAGE_INTAKE, FOUNDATION_MESSAGE_CONTRACT_ID, MKTG_AGENT_INTAKES, MKTG_DOCUMENT_TYPES, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgGenerateRequest, MktgRevisionResponse, MktgRevisionSummary, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { findMktgRunIntake } from '@lfx-one/shared/utils';
import { returningRunFixture } from '@lfx-one/shared/utils/__fixtures__/mktg-returning-run.fixture';
import { MktgAnswerMemoryService } from '@services/mktg-answer-memory.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { filter, firstValueFrom, of, take } from 'rxjs';
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
  const revision: MktgRevisionSummary = {
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
  };
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

  beforeEach(async () => {
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const activeContext = signal<ProjectContext | null>(project);
    await TestBed.configureTestingModule({
      providers: [
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
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: computed(() => activeContext()?.uid ?? '') } },
        { provide: UserService, useValue: { user: signal({ sub: 'synthetic-owner' }), impersonating: signal(false) } },
        { provide: ProjectService, useValue: { getProject: () => of({ ...project, writer: true }) } },
        { provide: MktgAnswerMemoryService, useValue: { load: () => ({}), remember: vi.fn() } },
        { provide: MktgDependencyService, useValue: { resolveDependencies: () => of({}), resolveBrandKit: () => of(null), notifyDocumentsChanged: vi.fn() } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
  });
  afterEach(() => {
    harness?.fixture.destroy();
    http?.verify();
    vi.useRealTimers();
    window.localStorage.clear();
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
      http.match((candidate) => candidate.url.endsWith(`/documents/${target.agentKey}/living`)).forEach((read) => expect(read.cancelled).toBe(true));
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
      await settle();
      expect(router.url).toContain(`revision=${revisionId}`);
      expect(query(fixture.selector)).not.toBeNull();
      expect(query('mktg-document-view-unsupported-asset')).toBeNull();
      expect(query('mktg-document-view-run')).toBeNull();
      http.expectNone(registered.endpoints.generate);
    }
  );

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
    expect(query('mktg-document-view-run')).not.toBeNull();
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
    expect(query('mktg-agent-run-page')).not.toBeNull();
  });

  it.each(['project', 'foundation'])('returns another questions round to the intake receiver on the %s mount without another answers POST', async (lens) => {
    const frameworkType = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.catalogAgentId === FOUNDATION_MESSAGE_INTAKE.agentId);
    if (!frameworkType) {
      throw new Error('Missing framework type');
    }
    const req: MktgGenerateRequest = { ...request, agentId: FOUNDATION_MESSAGE_INTAKE.agentId, intake: FOUNDATION_MESSAGE_INTAKE };
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.save({
      request: req,
      state: 'writing',
      attempt: { session: { agentId: req.agentId, sessionId: 'synthetic-framework-session', ownerToken: 'synthetic-proof' }, priorVersion: 0 },
      answered: { questions: [], answers: [], questionsId: 'a1234567' },
      updatedAt: new Date().toISOString(),
    });
    const token = attempts.prepare(req, true);
    await harness.navigateByUrl(`/${lens}/mktg-os-agents/documents/${frameworkType.agentKey}/living?generation=${token}`, MktgDocumentViewComponent);
    await settle();
    http
      .expectOne((candidate) => candidate.url.endsWith(`/documents/${frameworkType.agentKey}/living`))
      .flush({ project: project.uid, type: frameworkType, documentId: 'living', revisions: [], runs: [] });
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    const returned = navigation();
    http.expectOne(req.intake.endpoints.result).flush({
      status: 'questions',
      questionsId: 'b1234567',
      questions: [{ key: 'goal', label: 'Goal', question: 'Which goal?', why: '', suggestedAnswer: 'Adoption', basis: [] }],
    });
    await returned;
    await settle();
    expect(router.url).toContain(`/${lens}/mktg-os-agents/${req.agentId}?`);
    expect(router.url).toContain('questions=');
    expect(query('mktg-agent-run-questions')?.textContent).toContain('Which goal?');
    http.expectNone(req.intake.endpoints.answers ?? 'no-answers-endpoint');
    http.expectNone(req.intake.endpoints.generate);
  });
});

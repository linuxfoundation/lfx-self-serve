// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FOUNDATION_MESSAGE_INTAKE, MKTG_AGENT_INTAKES, MKTG_DOCUMENT_TYPES, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgGenerateRequest, MktgRevisionResponse, MktgRevisionSummary, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
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

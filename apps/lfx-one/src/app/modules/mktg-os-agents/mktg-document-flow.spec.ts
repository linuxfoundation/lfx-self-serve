// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE, MKTG_DOCUMENT_TYPES, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgDocumentType, MktgRevisionResponse, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
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

describe('Marketing document flow through the real nested router and run service', () => {
  const project: ProjectContext = { uid: 'synthetic-project', slug: 'synthetic-orbit', name: 'Synthetic Orbit' };
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'brand-kit') as MktgDocumentType;
  const revisionId = `000001-${'a'.repeat(64)}`;
  const stored: MktgRevisionResponse = {
    project: project.uid,
    type,
    documentId: 'living',
    runs: [],
    markdown: '# Synthetic routed revision',
    revisions: [
      {
        id: revisionId,
        number: 1,
        createdAt: '2026-10-19T08:00:00Z',
        origin: 'generated',
        restoredFromNumber: null,
        intakeMode: 'form',
        status: 'Draft — for review',
        contentSha256: 'a'.repeat(64),
        commentCount: 0,
        latest: true,
      },
    ],
    revision: {
      id: revisionId,
      number: 1,
      createdAt: '2026-10-19T08:00:00Z',
      origin: 'generated',
      restoredFromNumber: null,
      intakeMode: 'form',
      status: 'Draft — for review',
      contentSha256: 'a'.repeat(64),
      commentCount: 0,
      latest: true,
    },
  };
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;
  const query = (id: string) => harness.routeNativeElement?.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const nextNavigation = () =>
    firstValueFrom(
      router.events.pipe(
        filter((event) => event instanceof NavigationEnd),
        take(1)
      )
    );

  beforeEach(async () => {
    window.localStorage.clear();
    // RxJS uses intervals; leave the router/change-detection timeouts real.
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
        { provide: UserService, useValue: { user: signal({ sub: 'synthetic-owner' }) } },
        { provide: ProjectService, useValue: { getProject: vi.fn(() => of(project)) } },
        { provide: MktgAnswerMemoryService, useValue: { load: () => ({}), remember: vi.fn() } },
        { provide: MktgDependencyService, useValue: { resolveDependencies: () => of({}), notifyDocumentsChanged: vi.fn() } },
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

  it.each(['project', 'foundation'])('generates exactly once through the %s mount, then lands the receipt revision', async (lens) => {
    const intake = await harness.navigateByUrl(`/${lens}/mktg-os-agents/brand-kit?project=${project.slug}`, MktgAgentRunComponent);
    await harness.fixture.whenStable();
    for (const field of BRAND_KIT_INTAKE.fields) {
      intake['intakeForm'].controls[field.key].setValue(
        field.format?.startsWith('github') ? 'https://github.com/synthetic-org/synthetic-project' : 'Synthetic answer'
      );
    }
    await harness.fixture.whenStable();
    const posts = vi.spyOn(TestBed.inject(HttpClient), 'post');
    const navigation = nextNavigation();
    const button = query('mktg-agent-run-submit-button')?.querySelector('button');
    expect(button?.disabled).toBe(false);
    button?.click();
    await navigation;
    harness.detectChanges();
    http.expectOne((request) => request.method === 'GET' && request.url.endsWith('/brand-kit/living')).flush({}, { status: 404, statusText: 'Not found' });
    http.expectOne(BRAND_KIT_INTAKE.endpoints.generate).flush({ sessionId: 'synthetic-session', ownerToken: 'synthetic-token' });
    harness.detectChanges();
    expect(query('mktg-document-view-generating')).toBeTruthy();
    expect(query('mktg-document-view-document')).toBeNull();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    const landed = nextNavigation();
    http.expectOne(BRAND_KIT_INTAKE.endpoints.result).flush({
      status: 'ready',
      version: 1,
      documentMarkdown: stored.markdown,
      persistence: {
        project: project.uid,
        version: 1,
        s3_key: 'synthetic-key',
        content_sha256: 'a'.repeat(64),
        document: { agentKey: 'brand-kit', documentId: 'living', revisionId },
      },
    });
    await landed;
    harness.detectChanges();
    http.expectOne((request) => request.method === 'GET' && request.url.includes(`/revisions/${revisionId}`)).flush(stored);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(query('mktg-document-view-document')?.textContent).toContain('Synthetic routed revision');
    expect(posts.mock.calls.filter(([url]) => url === BRAND_KIT_INTAKE.endpoints.generate)).toHaveLength(1);
    expect(router.parseUrl(router.url).queryParams['project']).toBe(project.slug);
    expect(router.parseUrl(router.url).queryParams['revision']).toBe(revisionId);
  });

  it.each(['project', 'foundation'])('returns to the intake without leaving the %s mount', async (lens) => {
    await harness.navigateByUrl(`/${lens}/mktg-os-agents/documents/brand-kit/living?project=${project.slug}`, MktgDocumentViewComponent);
    http.expectOne((request) => request.method === 'GET' && request.url.endsWith('/brand-kit/living')).flush({}, { status: 404, statusText: 'Not found' });
    await harness.fixture.whenStable();
    harness.detectChanges();
    const navigation = nextNavigation();
    query('mktg-document-view-intake-link')?.click();
    await navigation;
    harness.detectChanges();
    expect(router.url.split('?')[0]).toBe(`/${lens}/mktg-os-agents/brand-kit`);
    expect(router.parseUrl(router.url).queryParams['project']).toBe(project.slug);
  });

  it.each(['project', 'foundation'])('hands questions to the intake inside the %s mount without another Generate', async (lens) => {
    const service = TestBed.inject(MktgAgentRunService);
    const token = service.prepareGeneration({
      projectUid: project.uid,
      agentId: 'foundation-setup',
      intake: FOUNDATION_MESSAGE_INTAKE,
      answers: { project_name: project.name },
    });
    const posts = vi.spyOn(TestBed.inject(HttpClient), 'post');
    await harness.navigateByUrl(
      `/${lens}/mktg-os-agents/documents/foundation-message/living?project=${project.slug}&generation=${token}`,
      MktgDocumentViewComponent
    );
    http
      .expectOne((request) => request.method === 'GET' && request.url.endsWith('/foundation-message/living'))
      .flush({}, { status: 404, statusText: 'Not found' });
    http.expectOne(FOUNDATION_MESSAGE_INTAKE.endpoints.generate).flush({ sessionId: 'synthetic-questions-session', ownerToken: 'synthetic-questions-token' });
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    const navigation = nextNavigation();
    http.expectOne(FOUNDATION_MESSAGE_INTAKE.endpoints.result).flush({
      status: 'questions',
      questionsId: 'abc12345',
      questions: [{ key: 'audiences', label: 'Audiences', question: 'Which synthetic audience?', why: '', suggestedAnswer: 'Synthetic teams', basis: [] }],
    });
    await navigation;
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(router.url.split('?')[0]).toBe(`/${lens}/mktg-os-agents/foundation-setup`);
    expect(router.parseUrl(router.url).queryParams['project']).toBe(project.slug);
    expect(router.parseUrl(router.url).queryParams['questions']).toBeTruthy();
    expect(posts.mock.calls.filter(([url]) => url === FOUNDATION_MESSAGE_INTAKE.endpoints.generate)).toHaveLength(1);
  });
});

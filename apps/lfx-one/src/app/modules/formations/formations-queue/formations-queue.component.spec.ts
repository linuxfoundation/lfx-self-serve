// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { FormationService } from '@services/formation.service';
import { ProjectApplicationService } from '@services/project-application.service';
import { ProjectService } from '@services/project.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ProjectContextService } from '@services/project-context.service';
import { createEmptyFormationsQueueResponse } from '@lfx-one/shared/constants';
import { emptyPipelineCounts } from '@lfx-one/shared/utils';
import type { FormationsQueueResponse, ProjectApplication, ProjectContext } from '@lfx-one/shared/interfaces';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FormationsQueueComponent } from './formations-queue.component';

describe('FormationsQueueComponent — foundation scoping (GH-2367)', () => {
  let fixture: ComponentFixture<FormationsQueueComponent>;
  let getFormationsQueue: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<ProjectContext | null>>;

  const render = async (): Promise<void> => {
    TestBed.resetTestingModule();
    getFormationsQueue = vi.fn(() => of(createEmptyFormationsQueueResponse()));
    selectedFoundation = signal<ProjectContext | null>(null);

    await TestBed.configureTestingModule({
      imports: [FormationsQueueComponent],
      providers: [
        provideRouter([]),
        { provide: FormationService, useValue: { getFormationsQueue } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: ProjectApplicationService, useValue: { getAccess: () => of(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationsQueueComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('fetches root-scoped (no foundation_uid) when no foundation is selected', async () => {
    await render();

    expect(getFormationsQueue).toHaveBeenCalledWith(undefined, '', undefined);
  });

  it('forwards the selected foundation uid once a foundation is chosen', async () => {
    await render();

    selectedFoundation.set({ uid: 'aaif-uid-1', name: 'AAIF', slug: 'aaif' } as ProjectContext);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getFormationsQueue).toHaveBeenLastCalledWith(undefined, '', 'aaif-uid-1');
  });

  it('drops the foundation_uid param again once the selection is cleared', async () => {
    await render();

    selectedFoundation.set({ uid: 'aaif-uid-1', name: 'AAIF', slug: 'aaif' } as ProjectContext);
    fixture.detectChanges();
    await fixture.whenStable();

    selectedFoundation.set(null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getFormationsQueue).toHaveBeenLastCalledWith(undefined, '', undefined);
  });
});

describe('FormationsQueueComponent — "In formation" tile subLine (GH-2366, GH-2584)', () => {
  let fixture: ComponentFixture<FormationsQueueComponent>;

  const render = async (response: FormationsQueueResponse): Promise<void> => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [FormationsQueueComponent],
      providers: [
        provideRouter([]),
        { provide: FormationService, useValue: { getFormationsQueue: vi.fn(() => of(response)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal<ProjectContext | null>(null) } },
        { provide: ProjectApplicationService, useValue: { getAccess: () => of(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationsQueueComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  // GH-2584 removed the clause this pair used to assert. The queue now lists only formations still
  // in progress, so "outside formation stages" described none of its rows — an unmapped row is
  // inside formation at a sub-stage the tiles have no name for. The count is still computed and
  // still logged server-side as the detector for a new upstream sub-stage; it just has no honest
  // one-line phrasing, so the tile stays silent about it.
  it('never claims rows are outside formation stages, even when tiles.unmapped is non-zero', async () => {
    await render({
      rows: [],
      tiles: { total: 8, foundations: 1, projects: 7, exploratory: 5, engaged: 1, on_hold: 0, unmapped: 2, ready: 0, blocked: 0, blocked_items: 0 },
    });

    const subLine = fixture.nativeElement.querySelector('[data-testid="stat-card-In formation"] .text-xs')?.textContent;
    expect(subLine).not.toContain('outside formation stages');
    // Asserted positively too: `not.toContain` alone would also pass on an empty or missing
    // subLine, which is a different bug that would otherwise ship unnoticed.
    expect(subLine).toContain('1 foundation · 7 projects');
  });

  it('renders the foundations and projects breakdown when there is nothing in the queue', async () => {
    await render(createEmptyFormationsQueueResponse());

    const subLine = fixture.nativeElement.querySelector('[data-testid="stat-card-In formation"] .text-xs')?.textContent;
    expect(subLine).toContain('0 foundations · 0 projects');
  });
});

describe('FormationsQueueComponent — health tiles (#2782)', () => {
  let fixture: ComponentFixture<FormationsQueueComponent>;

  const render = async (response: FormationsQueueResponse): Promise<void> => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [FormationsQueueComponent],
      providers: [
        provideRouter([]),
        { provide: FormationService, useValue: { getFormationsQueue: vi.fn(() => of(response)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal<ProjectContext | null>(null) } },
        { provide: ProjectApplicationService, useValue: { getAccess: () => of(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationsQueueComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const tile = (label: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="stat-card-${label}"]`);

  // "Ready to activate" used to be `rows().filter(gates_cleared).length` — a count over the
  // served, already-filtered rows — while its neighbours came from the server's unfiltered
  // tiles. With rows empty here, that old formula would read 0 against a server count of 2.
  it('reads every tile from the server counts, never from the served rows', async () => {
    await render({
      rows: [],
      tiles: { total: 5, foundations: 2, projects: 3, exploratory: 1, engaged: 3, on_hold: 1, unmapped: 0, ready: 2, blocked: 1, blocked_items: 3 },
    });

    expect(tile('In formation')?.querySelector('p')?.textContent?.trim()).toBe('5');
    expect(tile('Ready to activate')?.querySelector('p')?.textContent?.trim()).toBe('2');
    expect(tile('Blocked')?.querySelector('p')?.textContent?.trim()).toBe('1');
    expect(tile('Blocked')?.textContent).toContain('3 blocked items');
    expect(tile('On hold')?.querySelector('p')?.textContent?.trim()).toBe('1');
    // The per-stage counts moved onto the filter pills, where the stage filter already is.
    expect(tile('Exploratory')).toBeNull();
    expect(tile('Engaged')).toBeNull();
  });

  it('singularises the breakdown copy', async () => {
    await render({
      rows: [],
      tiles: { total: 2, foundations: 1, projects: 1, exploratory: 0, engaged: 2, on_hold: 0, unmapped: 0, ready: 0, blocked: 1, blocked_items: 1 },
    });

    expect(tile('In formation')?.textContent).toContain('1 foundation · 1 project');
    expect(tile('Blocked')?.textContent).toContain('1 blocked item');
  });
});

function buildApplication(overrides: Partial<ProjectApplication> = {}): ProjectApplication {
  return {
    uid: 'a',
    state: 'submitted',
    revision: 1,
    submitter_username: 'jdoe',
    submitter_name: 'Jane Doe',
    submitter_email: 'jane@example.org',
    target_parent_uid: null,
    application: { project_name: 'Alpha' },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('FormationsQueueComponent — Project proposals tab (#3037)', () => {
  let getFormationsQueue: ReturnType<typeof vi.fn>;
  let getFormationPipeline: ReturnType<typeof vi.fn>;
  let getApplications: ReturnType<typeof vi.spyOn>;
  let applicationService: ProjectApplicationService;

  const render = async (options: {
    slug: string | null;
    isFormationTeam: boolean | Observable<boolean>;
    tab?: string;
    queue?: ProjectApplication[] | Observable<ProjectApplication[]>;
  }): Promise<ComponentFixture<FormationsQueueComponent>> => {
    TestBed.resetTestingModule();
    getFormationsQueue = vi.fn(() => of(createEmptyFormationsQueueResponse()));
    getFormationPipeline = vi.fn(() => of({ rows: [], counts: emptyPipelineCounts() }));
    await TestBed.configureTestingModule({
      imports: [FormationsQueueComponent],
      providers: [
        provideRouter([]),
        { provide: FormationService, useValue: { getFormationsQueue, getFormationPipeline } },
        {
          provide: ProjectContextService,
          useValue: {
            selectedFoundation: signal<ProjectContext | null>(
              options.slug ? ({ uid: 'f-uid', name: 'Foundation', slug: options.slug } as ProjectContext) : null
            ),
          },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(options.tab ? { tab: options.tab } : {})) } },
        { provide: ProjectService, useValue: { searchProjects: () => of([]) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        DialogService,
      ],
    }).compileComponents();

    applicationService = TestBed.inject(ProjectApplicationService);
    vi.spyOn(applicationService, 'getAccess').mockReturnValue(
      typeof options.isFormationTeam === 'boolean' ? of(options.isFormationTeam) : options.isFormationTeam
    );
    const queue = options.queue ?? [];
    getApplications = vi.spyOn(applicationService, 'getApplications').mockReturnValue(Array.isArray(queue) ? of(queue) : queue);

    const fixture = TestBed.createComponent(FormationsQueueComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  const query = (fixture: ComponentFixture<FormationsQueueComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('offers the tab on The Linux Foundation to a formation-team member', async () => {
    const fixture = await render({ slug: 'tlf', isFormationTeam: true });
    expect(query(fixture, 'formations-queue-page-tabs-proposals')).not.toBeNull();
    expect(query(fixture, 'formations-queue-proposals')).toBeNull();
  });

  it('renders the staff queue for ?tab=proposals and skips the formations read', async () => {
    const fixture = await render({ slug: 'tlf', isFormationTeam: true, tab: 'proposals' });
    expect(getFormationsQueue).not.toHaveBeenCalled();
    expect(query(fixture, 'formations-queue-proposals')).not.toBeNull();
    expect(query(fixture, 'project-applications-staff')).not.toBeNull();
  });

  it('holds the formations read on a cold ?tab=proposals load until the access check answers', async () => {
    const access = new Subject<boolean>();
    const fixture = await render({ slug: 'tlf', isFormationTeam: access.asObservable(), tab: 'proposals' });
    expect(getFormationsQueue).not.toHaveBeenCalled();

    // Not on the formation team: the proposals tab isn't available, so the formations list loads now.
    access.next(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getFormationsQueue).toHaveBeenCalledTimes(1);
  });

  it('keeps the formations read skipped once access confirms a formation-team member', async () => {
    const access = new Subject<boolean>();
    const fixture = await render({ slug: 'tlf', isFormationTeam: access.asObservable(), tab: 'proposals' });
    access.next(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getFormationsQueue).not.toHaveBeenCalled();
  });

  it('hides the tab from a caller outside the formation team, even with ?tab=proposals', async () => {
    const fixture = await render({ slug: 'tlf', isFormationTeam: false, tab: 'proposals' });
    expect(query(fixture, 'formations-queue-page-tabs')).toBeNull();
    expect(query(fixture, 'formations-queue-proposals')).toBeNull();
  });

  describe('pending count (#5229)', () => {
    const queue = [
      buildApplication({ uid: 'a' }),
      buildApplication({ uid: 'b' }),
      buildApplication({ uid: 'c' }),
      buildApplication({ uid: 'd', state: 'denied' }),
      buildApplication({ uid: 'e', state: 'withdrawn' }),
    ];
    const tab = (fixture: ComponentFixture<FormationsQueueComponent>): HTMLElement => query(fixture, 'formations-queue-page-tabs-proposals') as HTMLElement;
    const count = (fixture: ComponentFixture<FormationsQueueComponent>): string | null =>
      query(fixture, 'formations-queue-page-tabs-proposals-count')?.textContent?.trim() ?? null;

    it('shows only the submitted proposals as the count, with an accessible name that includes it', async () => {
      const fixture = await render({ slug: 'tlf', isFormationTeam: true, queue });
      expect(count(fixture)).toBe('3');
      expect(tab(fixture).textContent).toContain('Project proposals');
      expect(tab(fixture).getAttribute('aria-label')).toBe('Project proposals, 3 awaiting review');
    });

    it('shows no number for zero pending proposals', async () => {
      const fixture = await render({ slug: 'tlf', isFormationTeam: true, queue: [buildApplication({ state: 'denied' })] });
      expect(count(fixture)).toBeNull();
      expect(tab(fixture).getAttribute('aria-label')).toBeNull();
    });

    it('shows no number while the read is pending', async () => {
      const fixture = await render({ slug: 'tlf', isFormationTeam: true, queue: new Subject<ProjectApplication[]>() });
      expect(count(fixture)).toBeNull();
    });

    it('shows no number, never (0), when the read fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fixture = await render({ slug: 'tlf', isFormationTeam: true, queue: throwError(() => new Error('boom')) });
      expect(count(fixture)).toBeNull();
      expect(tab(fixture).textContent).not.toContain('0');
    });

    it('drops the count as soon as an accept, deny or withdraw lands, without a refetch', async () => {
      const fixture = await render({ slug: 'tlf', isFormationTeam: true, queue });
      const reads = getApplications.mock.calls.length;
      applicationService.recordWrite('staff', buildApplication({ uid: 'a', state: 'denied', revision: 2 }));
      fixture.detectChanges();
      expect(count(fixture)).toBe('2');
      expect(getApplications.mock.calls.length).toBe(reads);
    });

    it('makes no queue request for a non-team member or a non-LF foundation', async () => {
      await render({ slug: 'tlf', isFormationTeam: false, queue });
      expect(getApplications).not.toHaveBeenCalled();
      await render({ slug: 'cncf', isFormationTeam: true, queue });
      expect(getApplications).not.toHaveBeenCalled();
    });

    it('makes exactly one queue request with the panel open and the count shown', async () => {
      // An in-flight read, as over HTTP: the page's refresh and the panel's must join it rather than add a second.
      const inFlight = new Subject<ProjectApplication[]>();
      const fixture = await render({ slug: 'tlf', isFormationTeam: true, tab: 'proposals', queue: inFlight });
      expect(query(fixture, 'formations-queue-proposals')).not.toBeNull();
      expect(getApplications).toHaveBeenCalledTimes(1);

      inFlight.next(queue);
      inFlight.complete();
      fixture.detectChanges();
      expect(count(fixture)).toBe('3');
      expect(getApplications).toHaveBeenCalledTimes(1);
    });
  });

  describe('Pipeline tab (#5475)', () => {
    it('is the default tab for a formation-team member on The Linux Foundation, first in the bar', async () => {
      const fixture = await render({ slug: 'tlf', isFormationTeam: true });
      expect(query(fixture, 'formations-queue-pipeline')).not.toBeNull();
      expect(query(fixture, 'formations-queue-page-tabs-pipeline')?.getAttribute('aria-selected')).toBe('true');
      expect(
        query(fixture, 'formations-queue-page-tabs-pipeline')?.compareDocumentPosition(query(fixture, 'formations-queue-page-tabs-formations') as Node)
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(getFormationPipeline).toHaveBeenCalled();
    });

    it('makes no formations read while Pipeline shows, and holds it until access answers on a bare link', async () => {
      const access = new Subject<boolean>();
      const fixture = await render({ slug: 'tlf', isFormationTeam: access.asObservable() });
      expect(getFormationsQueue).not.toHaveBeenCalled();
      access.next(true);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(getFormationsQueue).not.toHaveBeenCalled();
    });

    it('opens ?tab=pipeline directly', async () => {
      const fixture = await render({ slug: 'tlf', isFormationTeam: true, tab: 'pipeline' });
      expect(query(fixture, 'formations-queue-pipeline')).not.toBeNull();
    });

    it("shows today's page for ?tab=formations", async () => {
      const fixture = await render({ slug: 'tlf', isFormationTeam: true, tab: 'formations' });
      expect(query(fixture, 'formations-queue-pipeline')).toBeNull();
      expect(getFormationsQueue).toHaveBeenCalled();
      expect(getFormationPipeline).not.toHaveBeenCalled();
    });

    it('leaves the page unchanged for a non-team member, even with ?tab=pipeline', async () => {
      const fixture = await render({ slug: 'tlf', isFormationTeam: false, tab: 'pipeline' });
      expect(query(fixture, 'formations-queue-pipeline')).toBeNull();
      expect(query(fixture, 'formations-queue-page-tabs-pipeline')).toBeNull();
      expect(getFormationPipeline).not.toHaveBeenCalled();
      expect(getFormationsQueue).toHaveBeenCalled();
    });

    it('leaves the page unchanged on any other foundation', async () => {
      const fixture = await render({ slug: 'cncf', isFormationTeam: true });
      expect(query(fixture, 'formations-queue-pipeline')).toBeNull();
      expect(getFormationPipeline).not.toHaveBeenCalled();
    });
  });

  it('hides the tab on any other foundation', async () => {
    const fixture = await render({ slug: 'cncf', isFormationTeam: true, tab: 'proposals' });
    expect(query(fixture, 'formations-queue-page-tabs')).toBeNull();
    expect(query(fixture, 'formations-queue-proposals')).toBeNull();
  });
});

describe('FormationsQueueComponent — "Propose a project" button (#5187)', () => {
  let fixture: ComponentFixture<FormationsQueueComponent>;
  let selectedFoundation: ReturnType<typeof signal<ProjectContext | null>>;

  const render = async (foundation: ProjectContext | null): Promise<void> => {
    TestBed.resetTestingModule();
    selectedFoundation = signal<ProjectContext | null>(foundation);
    await TestBed.configureTestingModule({
      imports: [FormationsQueueComponent],
      providers: [
        provideRouter([]),
        { provide: FormationService, useValue: { getFormationsQueue: vi.fn(() => of(createEmptyFormationsQueueResponse())) } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: ProjectApplicationService, useValue: { getAccess: () => of(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FormationsQueueComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const button = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="formations-queue-propose-project"]');
  const href = (): string | null => button()?.querySelector('a')?.getAttribute('href') ?? null;

  it('links to the propose form with the selected foundation as the parent', async () => {
    await render({ uid: 'aaif-uid-1', name: 'Agentic AI Foundation', slug: 'aaif' } as ProjectContext);

    expect(button()?.textContent).toContain('Propose a project');
    expect(href()).toBe('/formations/propose?parent=aaif-uid-1');
  });

  it('is offered on The Linux Foundation root too, without exposing the proposals tab to a non-team viewer', async () => {
    await render({ uid: 'tlf-uid-1', name: 'The Linux Foundation', slug: 'tlf' } as ProjectContext);

    expect(href()).toBe('/formations/propose?parent=tlf-uid-1');
    expect((fixture.nativeElement as HTMLElement).querySelector('lfx-formation-page-tabs')).toBeNull();
  });

  it('follows the selection, and is hidden until a foundation is selected', async () => {
    await render(null);
    expect(button()).toBeNull();

    selectedFoundation.set({ uid: 'aaif-uid-1', name: 'Agentic AI Foundation', slug: 'aaif' } as ProjectContext);
    fixture.detectChanges();
    expect(href()).toBe('/formations/propose?parent=aaif-uid-1');
  });
});

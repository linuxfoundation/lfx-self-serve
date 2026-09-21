// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { FormationService } from '@services/formation.service';
import { ProjectContextService } from '@services/project-context.service';
import { createUnavailableFormationPeopleResponse } from '@lfx-one/shared/constants';
import { Formation, FormationChecklistResponse, FormationLifecycle } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FormationChecklistSectionComponent } from './formation-checklist-section.component';

// GH-2328: this component previously had no spec at all — per plan, add a focused one for
// read-only only rather than attempting to backfill the whole component.

function buildFormation(lifecycle: FormationLifecycle | null, lifecycleRaw: string): Formation {
  return {
    parent_project_uid: 'project:test',
    parent_project_slug: 'test-project',
    parent_project_name: 'Test Project',
    is_foundation: false,
    parent_uid: null,
    template_uid: 'template:test',
    template_version: 1,
    sub_stage: null,
    sub_stage_raw: 'Formation - Engaged',
    lifecycle,
    lifecycle_raw: lifecycleRaw,
    announcement_date: null,
    is_activating: false,
    gating_items_open: 0,
    gating_items_total: 0,
    blocking_item_title: null,
    subtitle: null,
  };
}

function buildResponse(lifecycle: FormationLifecycle | null, lifecycleRaw: string, canWrite = true, canSetStatus = canWrite): FormationChecklistResponse {
  return {
    can_write: canWrite,
    can_set_status: canSetStatus,
    formation: buildFormation(lifecycle, lifecycleRaw),
    template: {
      uid: 'template:test',
      version: 1,
      name: 'Test template',
      sections: [{ key: 'legal', title: 'Legal and entity', items: [] }],
    },
    items: [
      {
        uid: 'formation-item:test',
        formation_uid: 'formation:test',
        project_uid: 'project:test',
        template_item_key: 'test-item',
        section_key: 'legal',
        section_title: 'Legal and entity',
        title: 'Test item',
        status: 'in_progress',
        is_gating: false,
        owner_team: null,
        audience: null,
        owner: null,
        due_date: null,
        action: 'manual',
        action_href: null,
        detail: null,
        notes: null,
        evidence_link: null,
        sub_items: [],
        skip_reason: null,
        available_actions: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        version: 1,
      },
    ],
  };
}

/** Item-drawer child calls this on open; omitting it fails GH-2573 as `getFormationItem is not a function`. */
function stubGetFormationItem(response: FormationChecklistResponse) {
  return vi.fn().mockReturnValue(
    of({
      item: response.items[0] ?? buildResponse('live', 'live').items[0],
      history: [],
      history_state: 'complete' as const,
    })
  );
}

function buildSharedProviders(fetchResult: Observable<FormationChecklistResponse>, ctx: WritableSignal<{ uid: string; name: string; slug: string } | null>) {
  return [
    provideHttpClient(),
    provideHttpClientTesting(),
    provideRouter([]),
    provideNoopAnimations(),
    { provide: MessageService, useValue: { add: vi.fn() } },
    {
      provide: ProjectContextService,
      useValue: {
        activeContext: ctx,
        activeProjectAnnouncementDate: signal<string | null>(null),
        activeProjectAnnouncementDateLoading: signal(false),
        activeProjectAnnouncementDateHasError: signal(false),
      },
    },
  ];
}

describe('FormationChecklistSectionComponent', () => {
  let fixture: ComponentFixture<FormationChecklistSectionComponent>;
  let getProjectFormation: ReturnType<typeof vi.fn>;
  let getQueueFormationChecklist: ReturnType<typeof vi.fn>;
  let activeContext: WritableSignal<{ uid: string; name: string; slug: string } | null>;

  const render = async (
    response: FormationChecklistResponse,
    options: {
      projectSlug?: string;
      /** Overrides what the checklist read returns — e.g. a `throwError` for the failure branch. */
      fetchResult?: Observable<FormationChecklistResponse>;
      /** `null` leaves the component with no slug at all (neither input nor context). */
      contextSlug?: string | null;
      onResponseLoaded?: (value: FormationChecklistResponse | null) => void;
    } = {}
  ): Promise<void> => {
    TestBed.resetTestingModule();
    const fetchResult = options.fetchResult ?? of(response);
    const contextSlug = options.contextSlug === undefined ? 'test-project' : options.contextSlug;
    // Held so a spec can drive a context-driven project switch — the only way `/project/formation`
    // switches projects in production (the `?project=` query param moves `activeContext`; that
    // page never sets the `projectSlug` input).
    activeContext = signal(contextSlug ? { uid: 'project:test', name: 'Test Project', slug: contextSlug } : null);
    getProjectFormation = vi.fn().mockReturnValue(fetchResult);
    getQueueFormationChecklist = vi.fn().mockReturnValue(fetchResult);
    await TestBed.configureTestingModule({
      imports: [FormationChecklistSectionComponent],
      providers: [
        ...buildSharedProviders(fetchResult, activeContext),
        {
          provide: FormationService,
          useValue: {
            getProjectFormation,
            getQueueFormationChecklist,
            getFormationItem: stubGetFormationItem(response),
            // The drawer also reads the people behind its assignee picker on open (#2594); the
            // unavailable shape keeps it on the directory path these specs already cover.
            getFormationPeople: vi.fn().mockReturnValue(of(createUnavailableFormationPeopleResponse())),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationChecklistSectionComponent);
    if (options.projectSlug !== undefined) {
      fixture.componentRef.setInput('projectSlug', options.projectSlug);
    }
    if (options.onResponseLoaded) {
      fixture.componentInstance.responseLoaded.subscribe(options.onResponseLoaded);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const banner = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="formation-checklist-read-only-banner"]');

  it('does not render the read-only banner when lifecycle is live', async () => {
    await render(buildResponse('live', 'live'));

    expect(fixture.componentInstance['readOnly']()).toBe(false);
    expect(banner()).toBeNull();
  });

  it('renders the read-only banner with "complete" copy for a completed formation', async () => {
    await render(buildResponse('completed', 'completed'));

    expect(fixture.componentInstance['readOnly']()).toBe(true);
    expect(banner()?.textContent).toContain('This formation is complete.');
  });

  it('renders the read-only banner with "frozen" copy for a frozen formation', async () => {
    await render(buildResponse('frozen', 'frozen'));

    expect(fixture.componentInstance['readOnly']()).toBe(true);
    expect(banner()?.textContent).toContain('This formation is frozen.');
  });

  it('renders the read-only banner naming the raw value for an unrecognized lifecycle', async () => {
    await render(buildResponse(null, 'archived'));

    expect(fixture.componentInstance['readOnly']()).toBe(true);
    expect(banner()?.textContent).toContain('This formation is read-only (status: "archived").');
  });

  it('passes readOnly through to the row and the drawer', async () => {
    await render(buildResponse('frozen', 'frozen'));

    const row = fixture.nativeElement.querySelector('lfx-formation-checklist-row');
    const drawer = fixture.nativeElement.querySelector('lfx-formation-item-drawer');
    expect(row).not.toBeNull();
    expect(drawer).not.toBeNull();
    // readOnly is bound as a property, not reflected as an attribute — assert via the child
    // component instances' inputs instead of the DOM attribute.
    const rowDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-checklist-row');
    const drawerDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-item-drawer');
    expect(rowDebugEl.componentInstance.readOnly()).toBe(true);
    expect(drawerDebugEl.componentInstance.readOnly()).toBe(true);
  });

  // GH-2694: the drawer's `canWrite` input previously went unbound here, defaulting `true` — every
  // caller was offered editable assignee/due-date fields whose writer-gated upstream route then
  // refused the save (and, when an assignee was refused, silently discarded the due date with it).
  it('passes the response can_write through to the row and the drawer', async () => {
    await render(buildResponse('live', 'live', true));

    const rowDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-checklist-row');
    const drawerDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-item-drawer');
    expect(rowDebugEl.componentInstance.canWrite()).toBe(true);
    expect(drawerDebugEl.componentInstance.canWrite()).toBe(true);
  });

  it('passes canWrite false to the row and the drawer for a non-writer caller (fail-closed)', async () => {
    await render(buildResponse('live', 'live', false));

    const rowDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-checklist-row');
    const drawerDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-item-drawer');
    expect(rowDebugEl.componentInstance.canWrite()).toBe(false);
    expect(drawerDebugEl.componentInstance.canWrite()).toBe(false);
  });

  // GH-2705: can_set_status is the writer ∧ team:formation pair — the shipped defect was a writer
  // outside the formation team receiving status controls that could only 403, so the split
  // (canWrite true, canSetStatus false) is the case that matters.
  it('passes the response can_set_status through to the row and the drawer independently of can_write', async () => {
    await render(buildResponse('live', 'live', true, false));

    const rowDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-checklist-row');
    const drawerDebugEl = fixture.debugElement.query((el) => el.name === 'lfx-formation-item-drawer');
    expect(rowDebugEl.componentInstance.canWrite()).toBe(true);
    expect(rowDebugEl.componentInstance.canSetStatus()).toBe(false);
    expect(drawerDebugEl.componentInstance.canWrite()).toBe(true);
    expect(drawerDebugEl.componentInstance.canSetStatus()).toBe(false);
  });

  // LFXV2-3386: the foundation formations drill-down renders another project's checklist while the
  // project context still describes the foundation — the `projectSlug` input must win over the
  // context slug. (The strip's announcement-date override this mode used to feed is gone — the date
  // moved to the formation-page sidebar card, GH-2702.)
  describe('explicit projectSlug input (LFXV2-3386)', () => {
    it('fetches via the auditor-gated queue read for the input slug, never the context slug or the project-page read', async () => {
      await render(buildResponse('live', 'live'), { projectSlug: 'other-project' });

      // Explicit-slug mode is the auditor drill-down — it must use the requireAuditor-gated
      // endpoint (#2690 review) so the queue's root-auditor contract holds server-side.
      expect(getQueueFormationChecklist).toHaveBeenCalledWith('other-project');
      expect(getProjectFormation).not.toHaveBeenCalled();
    });

    it('uses the plain project-page read when no slug input is set', async () => {
      await render(buildResponse('live', 'live'));

      expect(getProjectFormation).toHaveBeenCalledWith('test-project');
      expect(getQueueFormationChecklist).not.toHaveBeenCalled();
    });
  });

  // #2719: both hosts render `lfx-formation-card` from this response, so the card needs no request
  // and no permission probe of its own — whoever can read the checklist sees the card beside it.
  describe('responseLoaded output (#2719)', () => {
    it('emits the fetched response', async () => {
      const response = buildResponse('live', 'live');
      const emitted: (FormationChecklistResponse | null)[] = [];

      await render(response, { onResponseLoaded: (value) => emitted.push(value) });

      expect(emitted).toEqual([response]);
    });

    it('emits null when the fetch fails, so a host clears rather than pairing a stale card with an errored checklist', async () => {
      const emitted: (FormationChecklistResponse | null)[] = [];

      await render(buildResponse('live', 'live'), {
        fetchResult: throwError(() => new Error('network error')),
        onResponseLoaded: (value) => emitted.push(value),
      });

      expect(emitted).toEqual([null]);
    });

    // Without this the rail would keep the previous project's slug, date and (uid-matched)
    // admin-tool link beside a checklist that has already flashed to skeletons for the new one.
    it('clears the host on a project switch, before the new response arrives', async () => {
      const response = buildResponse('live', 'live');
      const emitted: (FormationChecklistResponse | null)[] = [];

      await render(response, { projectSlug: 'other-project', onResponseLoaded: (value) => emitted.push(value) });
      expect(emitted).toEqual([response]);

      fixture.componentRef.setInput('projectSlug', 'third-project');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(emitted).toEqual([response, null, response]);
    });

    // The switch above drives the `projectSlug` input, which is the drill-down's contract but
    // never changes in place there (a route-param change destroys this component). The switch that
    // does happen in place is this one: `/project/formation` moves `activeContext` when `?project=`
    // changes, with the same component instance throughout. That is the path the clear exists for.
    it('clears the host on a context-driven project switch, the in-place switch /project/formation actually performs', async () => {
      const response = buildResponse('live', 'live');
      const emitted: (FormationChecklistResponse | null)[] = [];

      await render(response, { onResponseLoaded: (value) => emitted.push(value) });
      expect(emitted).toEqual([response]);

      activeContext.set({ uid: 'project:second', name: 'Second Project', slug: 'second-project' });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(emitted).toEqual([response, null, response]);
      expect(getProjectFormation).toHaveBeenLastCalledWith('second-project');
    });

    // A failed load clears the host; the retry that succeeds must put the card back, rather than
    // leaving the rail permanently empty for a caller who can read the checklist after all.
    it('re-emits the response when a retry succeeds after a failed load', async () => {
      const response = buildResponse('live', 'live');
      const emitted: (FormationChecklistResponse | null)[] = [];

      await render(response, {
        fetchResult: throwError(() => new Error('network error')),
        onResponseLoaded: (value) => emitted.push(value),
      });
      expect(emitted).toEqual([null]);

      getProjectFormation.mockReturnValue(of(response));
      fixture.componentInstance['refresh$'].next();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(emitted).toEqual([null, response]);
    });

    // A post-mutation refresh re-fetches the same project — the card's fields can't have changed
    // out from under it, so blanking the rail mid-refresh would only flicker.
    it('keeps the host copy across a same-slug refresh', async () => {
      const response = buildResponse('live', 'live');
      const emitted: (FormationChecklistResponse | null)[] = [];

      await render(response, { onResponseLoaded: (value) => emitted.push(value) });
      fixture.componentInstance['refresh$'].next();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(emitted).toEqual([response, response]);
    });

    it('emits null when there is no slug to fetch', async () => {
      const emitted: (FormationChecklistResponse | null)[] = [];

      await render(buildResponse('live', 'live'), { contextSlug: null, onResponseLoaded: (value) => emitted.push(value) });

      expect(emitted).toEqual([null]);
      expect(getProjectFormation).not.toHaveBeenCalled();
    });
  });

  // GH-2573: ?item=<key> deep-link from assignment emails
  describe('?item= deep-link (GH-2573)', () => {
    async function renderWithItem(
      itemKey: string | null,
      opts: {
        response?: FormationChecklistResponse;
        fetchResult?: Observable<FormationChecklistResponse>;
        /** Provide 'server' to assert the SSR guard short-circuits initDeepLink. */
        platformId?: string;
      } = {}
    ) {
      TestBed.resetTestingModule();
      const response = opts.response ?? buildResponse('live', 'live');
      const fetchResult = opts.fetchResult ?? of(response);
      const contextSignal = signal({ uid: 'project:test', name: 'Test Project', slug: 'test-project' });
      const formationMock = vi.fn().mockReturnValue(fetchResult);
      // Captured so callers can assert the drawer actually attempted the fetch with the right
      // project uid and item key — the regression being tested is that these inputs are non-null
      // when openTrigger$ fires (afterNextRender guarantees this).
      const getFormationItemSpy = vi.fn().mockReturnValue(new Subject());

      await TestBed.configureTestingModule({
        imports: [FormationChecklistSectionComponent],
        providers: [
          ...buildSharedProviders(fetchResult, contextSignal),
          // `getFormationItem` backs the item drawer's own fetch once the deep link opens it; a
          // never-emitting observable keeps the drawer in its loading state, which is all these
          // section specs need — the drawer's contents have their own spec.
          {
            provide: FormationService,
            useValue: {
              getProjectFormation: formationMock,
              getQueueFormationChecklist: formationMock,
              getFormationItem: getFormationItemSpy,
              getFormationPeople: vi.fn().mockReturnValue(of(createUnavailableFormationPeopleResponse())),
            },
          },
          { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: (k: string) => (k === 'item' ? itemKey : null) } } } },
          ...(opts.platformId ? [{ provide: PLATFORM_ID, useValue: opts.platformId }] : []),
        ],
      }).compileComponents();

      // location.replaceState is used instead of router.navigate to strip ?item= without
      // triggering a new Angular navigation cycle (which would re-run CanMatch/CanActivate
      // guards and risk a redirect away from this page).
      const location = TestBed.inject(Location);
      const replaceStateSpy = vi.spyOn(location, 'replaceState').mockImplementation(() => undefined);

      const f = TestBed.createComponent(FormationChecklistSectionComponent);
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();
      // afterNextRender defers drawerVisible.set(true) to the next render cycle so that
      // [itemProjectUid]/[itemKey] inputs are fully propagated before openTrigger$ fires.
      // One extra detectChanges runs that post-render hook and propagates the visible change.
      await f.whenStable();
      f.detectChanges();

      return { fixture: f, replaceStateSpy, formationMock, getFormationItemSpy };
    }

    it('opens the matching item drawer and clears ?item= from the URL', async () => {
      const { fixture, replaceStateSpy, getFormationItemSpy } = await renderWithItem('test-item');

      expect(fixture.componentInstance.drawerVisible()).toBe(true);
      expect(fixture.componentInstance.drawerItemAddress()).toEqual({ projectUid: 'project:test', itemKey: 'test-item' });
      expect(replaceStateSpy).toHaveBeenCalledOnce();
      // Regression guard for GH-2573: the drawer must call getFormationItem with the correct
      // inputs. If afterNextRender is removed and drawerVisible fires before the inputs propagate,
      // the drawer short-circuits with null values and getFormationItem is never called.
      expect(getFormationItemSpy).toHaveBeenCalledWith('project:test', 'test-item');
    });

    it('clears ?item= without opening a drawer when the key matches no item', async () => {
      const { fixture, replaceStateSpy } = await renderWithItem('unknown-key');

      expect(fixture.componentInstance.drawerVisible()).toBe(false);
      expect(replaceStateSpy).toHaveBeenCalledOnce();
    });

    it('clears ?item= on a terminal no-items state without opening a drawer', async () => {
      const emptyChecklist: FormationChecklistResponse = { ...buildResponse('live', 'live'), items: [] };
      const { fixture, replaceStateSpy } = await renderWithItem('test-item', { response: emptyChecklist });

      expect(fixture.componentInstance.drawerVisible()).toBe(false);
      expect(replaceStateSpy).toHaveBeenCalledOnce();
    });

    it('clears ?item= on a terminal no-template state without opening a drawer', async () => {
      const noTemplateResponse: FormationChecklistResponse = { ...buildResponse('live', 'live'), template: null };
      const { fixture, replaceStateSpy } = await renderWithItem('test-item', { response: noTemplateResponse });

      expect(fixture.componentInstance.drawerVisible()).toBe(false);
      expect(replaceStateSpy).toHaveBeenCalledOnce();
    });

    it('preserves ?item= on the retryable error state so an in-page retry can still open the drawer', async () => {
      const { fixture, replaceStateSpy } = await renderWithItem('test-item', {
        fetchResult: throwError(() => new Error('network error')),
      });

      expect(fixture.componentInstance.drawerVisible()).toBe(false);
      expect(replaceStateSpy).not.toHaveBeenCalled();
    });

    it('opens the drawer and clears ?item= after an in-page retry succeeds', async () => {
      const response = buildResponse('live', 'live');
      // First call errors; second call (after onRetry) succeeds.
      const { fixture, replaceStateSpy, formationMock, getFormationItemSpy } = await renderWithItem('test-item', {
        fetchResult: throwError(() => new Error('network error')),
      });

      expect(fixture.componentInstance.drawerVisible()).toBe(false);
      expect(replaceStateSpy).not.toHaveBeenCalled();

      // Wire the retry to succeed, then trigger it.
      formationMock.mockReturnValue(of(response));
      fixture.componentInstance['onRetry']();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      // Same afterNextRender cycle needed as in renderWithItem.
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.drawerVisible()).toBe(true);
      expect(replaceStateSpy).toHaveBeenCalledOnce();
      // Same regression guard as the direct open case.
      expect(getFormationItemSpy).toHaveBeenCalledWith('project:test', 'test-item');
    });

    it('does not open a drawer or clear ?item= when running on the server (SSR guard)', async () => {
      const { fixture, replaceStateSpy } = await renderWithItem('test-item', { platformId: 'server' });

      expect(fixture.componentInstance.drawerVisible()).toBe(false);
      expect(replaceStateSpy).not.toHaveBeenCalled();
    });
  });
});

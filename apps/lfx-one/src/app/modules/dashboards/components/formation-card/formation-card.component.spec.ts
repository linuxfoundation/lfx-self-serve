// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Formation, Project, ProjectSettings } from '@lfx-one/shared/interfaces';
import { getFormationSubStageLabel } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { MessageService } from 'primeng/api';
import { catchError, map, Observable, of, Subject, tap, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FormationCardComponent } from './formation-card.component';

function project(stage: string, overrides: Partial<Project> = {}): Project {
  return {
    uid: 'proj-1',
    slug: 'project-one',
    description: '',
    name: 'Project One',
    public: true,
    parent_uid: '',
    stage,
    category: '',
    funding_model: [],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '',
    updated_at: '',
    mailing_list_count: 0,
    ...overrides,
  } as Project;
}

function settings(): ProjectSettings {
  return {
    uid: 'proj-1',
    announcement_date: '2026-09-01',
    writers: [],
    auditors: [],
    executive_director: { name: 'Ada Lovelace', email: 'ada@example.com' },
    program_manager: null,
    opportunity_owner: null,
    created_at: '',
    updated_at: '',
  };
}

describe('FormationCardComponent', () => {
  let fixture: ComponentFixture<FormationCardComponent>;
  let getProjectSpy: ReturnType<typeof vi.fn>;
  let getProjectSfidSpy: ReturnType<typeof vi.fn>;

  async function render(
    stage: string,
    auditor: boolean,
    options: {
      sfid?: string | null;
      settingsResult?: Observable<ProjectSettings>;
      projectOverrides?: Partial<Project>;
      getProjectResult?: Partial<Project>;
      readable?: boolean;
    } = {}
  ): Promise<void> {
    const { sfid = 'sfid-1', settingsResult = of(settings()), projectOverrides = {}, getProjectResult, readable = true } = options;
    TestBed.resetTestingModule();
    getProjectSpy = vi.fn(() => of(project(stage, { ...projectOverrides, auditor, ...getProjectResult })));

    // Mirrors ProjectContextService's own tri-state pipeline so the mock behaves like the real
    // shared signals (loading flips false, hasError flips true) rather than hardcoding both false.
    const announcementDateLoading = signal(true);
    const announcementDateHasError = signal(false);
    const announcementDate = signal<string | null>(null);
    settingsResult
      .pipe(
        map((s) => s.announcement_date || null),
        tap((date) => {
          announcementDate.set(date);
          announcementDateLoading.set(false);
        }),
        catchError(() => {
          announcementDateLoading.set(false);
          announcementDateHasError.set(true);
          return of(null);
        })
      )
      .subscribe();

    await TestBed.configureTestingModule({
      imports: [FormationCardComponent],
      providers: [
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: ProjectService,
          useValue: {
            getProjectSfid: () => of(sfid),
            getProject: getProjectSpy,
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            activeProject: signal(project(stage, projectOverrides)),
            activeProjectFormationSubStage: signal(getFormationSubStageLabel(stage)),
            activeProjectAnnouncementDate: announcementDate,
            activeProjectAnnouncementDateLoading: announcementDateLoading,
            activeProjectAnnouncementDateHasError: announcementDateHasError,
            activeProjectAnnouncementDateReadable: signal(readable),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationCardComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it.each([
    ['Formation - Exploratory', 'Exploratory'],
    ['Formation - Engaged', 'Engaged'],
    ['Formation - On Hold', 'On Hold'],
    ['Formation - Disengaged', 'Disengaged'],
    ['Formation - Confidential', 'Confidential'],
  ])('renders the %s sub-stage as %s', async (stage, label) => {
    await render(stage, false);

    expect(text()).toContain(label);
  });

  it('never renders the literal string "PCC", staff or not', async () => {
    await render('Formation - Engaged', false);
    expect(text()).not.toContain('PCC');

    await render('Formation - Engaged', true);
    expect(text()).not.toContain('PCC');
  });

  it('hides the admin-tool links and "Admin only" chip for a non-auditor, non-writer user', async () => {
    await render('Formation - Engaged', false);

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).toBeNull();
  });

  it('shows the admin-tool link and "Admin only" chip for an auditor with a resolved SFID', async () => {
    await render('Formation - Engaged', true, { sfid: 'sfid-1' });

    const links = fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]');
    expect(links).not.toBeNull();
    expect(text()).toContain('Admin only');
    expect(text()).toContain('Other fields in admin tool');
    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-tool-link"]').getAttribute('href')).toBe(
      'https://pcc.dev.platform.linuxfoundation.org/project/sfid-1'
    );
    expect(getProjectSpy).toHaveBeenCalledWith('proj-1', false, { auditor: true });
  });

  it('shows the admin-tool link for a project writer even though the server omits `auditor` for writers', async () => {
    // Mirrors the server: getProjectById returns early for writers, so `auditor` comes back
    // undefined rather than true. `isAuditor`'s `writer === true` OR-branch must still admit them.
    await render('Formation - Engaged', false, { sfid: 'sfid-1', getProjectResult: { writer: true, auditor: undefined } });

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).not.toBeNull();
  });

  it('hides the admin-tool links for an auditor with no v1 mapping (null SFID)', async () => {
    await render('Formation - Engaged', true, { sfid: null });

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).toBeNull();
  });

  it('omits the announcement date in context mode when the caller may not read settings', async () => {
    await render('Formation - Engaged', false, { readable: false });

    expect(text()).not.toContain('Announcement date');
    expect(text()).not.toContain('Not set');
    expect(text()).toContain('project-one');
    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-error"]')).toBeNull();
  });

  it('formats the announcement date via the shared ISO-date label, and falls back to "Not set"', async () => {
    await render('Formation - Engaged', false);
    expect(text()).toContain('Sep 1, 2026');

    await render('Formation - Engaged', false, { settingsResult: of({ ...settings(), announcement_date: '' }) });
    expect(text()).toContain('Not set');
  });

  // #2719: both checklist hosts pass the response their section just fetched, so the card costs no
  // extra request and is visible to whoever could read the checklist. On the foundation drill-down
  // ProjectContextService describes the PARENT FOUNDATION, so reading it here at all would pair the
  // foundation's slug with a child project's checklist — the throwing provider below is what keeps
  // that regression from reappearing.
  describe('formation input (#2719)', () => {
    /**
     * Every member the card reads in context mode, each of which throws. A Proxy would be terser
     * but Angular's injector profiler touches `constructor` on a provided value, so it would trip
     * on wiring rather than on a real read.
     */
    function throwingProjectContext(): Record<string, never> {
      const members = [
        'activeProject',
        'activeProjectFormationSubStage',
        'activeProjectAnnouncementDate',
        'activeProjectAnnouncementDateLoading',
        'activeProjectAnnouncementDateHasError',
        'activeProjectAnnouncementDateReadable',
      ];
      const stub: Record<string, unknown> = { refreshActiveProject };
      for (const member of members) {
        Object.defineProperty(stub, member, {
          get: () => {
            throw new Error(`FormationCardComponent read ProjectContextService.${member} while its formation input was set`);
          },
        });
      }
      return stub as Record<string, never>;
    }

    function formation(overrides: Partial<Formation> = {}): Formation {
      return {
        parent_project_uid: 'child-uid',
        parent_project_slug: 'child-project',
        parent_project_name: 'Child Project',
        is_foundation: false,
        parent_uid: null,
        template_uid: 'template:test',
        template_version: 1,
        sub_stage: null,
        sub_stage_raw: 'Formation - Engaged',
        lifecycle: null,
        lifecycle_raw: '',
        announcement_date: '2026-10-25',
        is_activating: false,
        gating_items_open: 0,
        gating_items_total: 0,
        blocking_item_title: null,
        subtitle: null,
        ...overrides,
      };
    }

    let openDrawer: ReturnType<typeof vi.fn>;
    let drawerClosed: Subject<boolean | undefined>;
    let refreshActiveProject: ReturnType<typeof vi.fn>;
    let updateFormationRecord: ReturnType<typeof vi.fn>;
    let messageAdd: ReturnType<typeof vi.fn>;
    let putRequest: Subject<Project>;

    async function renderWithInput(value: Formation, admin: { sfid?: string | null; auditor?: boolean } = {}): Promise<void> {
      TestBed.resetTestingModule();
      drawerClosed = new Subject<boolean | undefined>();
      openDrawer = vi.fn(() => ({ closed: drawerClosed }));
      refreshActiveProject = vi.fn();
      putRequest = new Subject<Project>();
      updateFormationRecord = vi.fn(() => putRequest);
      messageAdd = vi.fn();
      getProjectSpy = vi.fn(() => of(project('Formation - Engaged', { auditor: admin.auditor ?? false })));
      getProjectSfidSpy = vi.fn(() => of(admin.sfid ?? null));
      await TestBed.configureTestingModule({
        imports: [FormationCardComponent],
        providers: [
          {
            provide: ProjectService,
            useValue: {
              getProjectSfid: getProjectSfidSpy,
              getProject: getProjectSpy,
              getProjectRecord: () => of(project('Formation - Engaged')),
              updateFormationRecord,
            },
          },
          { provide: ProjectContextService, useValue: throwingProjectContext() },
          { provide: UiDrawerService, useValue: { open: openDrawer } },
          { provide: MessageService, useValue: { add: messageAdd } },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(FormationCardComponent);
      fixture.componentRef.setInput('formation', value);
      await fixture.whenStable();
      fixture.detectChanges();
    }

    describe('edit action (#5134)', () => {
      it('offers the edit button only when the host passes canEditRecord', async () => {
        await renderWithInput(formation());
        expect(fixture.nativeElement.querySelector('[data-testid="formation-card-edit-button"]')).toBeNull();

        fixture.componentRef.setInput('canEditRecord', true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-testid="formation-card-edit-button"]')).not.toBeNull();
      });

      it('keeps the read-only copy when editing is not allowed, and drops it when it is', async () => {
        await renderWithInput(formation());
        expect(text()).toContain('Stage and legal entity are set by the formation team');

        fixture.componentRef.setInput('canEditRecord', true);
        fixture.detectChanges();
        expect(text()).not.toContain('Stage and legal entity are set by the formation team');
      });

      it('does not offer the edit button without a project uid', async () => {
        await renderWithInput(formation({ parent_project_uid: undefined }));
        fixture.componentRef.setInput('canEditRecord', true);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('[data-testid="formation-card-edit-button"]')).toBeNull();
      });
    });

    interface DrawerConfig {
      data: { projectUid: string; openRequiredCount: number; save: (changes: { legal_entity_name: string }) => Observable<void> };
      canClose: () => boolean;
    }
    async function openEditDrawer(value = formation()): Promise<DrawerConfig> {
      await renderWithInput(value);
      fixture.componentRef.setInput('canEditRecord', true);
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('[data-testid="formation-card-edit-button"] button') as HTMLButtonElement).click();
      return openDrawer.mock.calls[0][1] as DrawerConfig;
    }

    it('opens the edit drawer through UiDrawerService with the project uid, open required count and a save callback', async () => {
      const config = await openEditDrawer(formation({ gating_items_open: 2 }));

      expect(config.data).toEqual({ projectUid: 'child-uid', openRequiredCount: 2, save: expect.any(Function) });
    });

    it('owns the write: the PUT runs once, refreshes the active project, tells the host and toasts, with the drawer only listening', async () => {
      const config = await openEditDrawer();
      const saved = vi.fn();
      fixture.componentInstance.recordSaved.subscribe(saved);
      const outcome = vi.fn();

      config.data.save({ legal_entity_name: 'Changed' }).subscribe(outcome);
      expect(updateFormationRecord).toHaveBeenCalledWith('child-uid', { legal_entity_name: 'Changed' });
      expect(refreshActiveProject).not.toHaveBeenCalled();

      putRequest.next(project('Formation - Engaged'));
      expect(refreshActiveProject).toHaveBeenCalledWith('child-uid');
      expect(saved).toHaveBeenCalledOnce();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
      expect(outcome).toHaveBeenCalledOnce();
    });

    it('completes the write and runs the refreshes even if the drawer is destroyed mid-PUT', async () => {
      const config = await openEditDrawer();
      const saved = vi.fn();
      fixture.componentInstance.recordSaved.subscribe(saved);

      // The drawer's own subscription is torn down with it; the write belongs to the card.
      const drawerSubscription = config.data.save({ legal_entity_name: 'Changed' }).subscribe();
      drawerSubscription.unsubscribe();
      drawerClosed.next(undefined);
      expect(putRequest.observed).toBe(true);

      putRequest.next(project('Formation - Engaged'));
      expect(refreshActiveProject).toHaveBeenCalledWith('child-uid');
      expect(saved).toHaveBeenCalledOnce();
    });

    it('does not tell the host about a save for a project the card no longer shows', async () => {
      const config = await openEditDrawer();
      const saved = vi.fn();
      fixture.componentInstance.recordSaved.subscribe(saved);

      config.data.save({ legal_entity_name: 'Changed' }).subscribe();
      fixture.componentRef.setInput('formation', formation({ parent_project_uid: 'other-uid', parent_project_slug: 'other-project' }));
      fixture.detectChanges();
      putRequest.next(project('Formation - Engaged'));

      expect(refreshActiveProject).toHaveBeenCalledWith('child-uid');
      expect(saved).not.toHaveBeenCalled();
    });

    it('does not emit after the card itself is destroyed, but still finishes the write', async () => {
      const config = await openEditDrawer();
      const saved = vi.fn();
      fixture.componentInstance.recordSaved.subscribe(saved);

      config.data.save({ legal_entity_name: 'Changed' }).subscribe();
      fixture.destroy();
      putRequest.next(project('Formation - Engaged'));

      expect(refreshActiveProject).toHaveBeenCalledWith('child-uid');
      expect(saved).not.toHaveBeenCalled();
    });

    it('keeps recording the drawer closure after the card is destroyed, and completes on the first emit', async () => {
      await openEditDrawer();

      fixture.destroy();
      expect(drawerClosed.observed).toBe(true);

      drawerClosed.next(undefined);
      expect(drawerClosed.observed).toBe(false);
    });

    describe('a failed write', () => {
      const failure = new Error('boom');

      it('reaches the drawer inline, without a toast, while the drawer is still listening', async () => {
        const config = await openEditDrawer();
        const outcome = vi.fn();

        config.data.save({ legal_entity_name: 'Changed' }).subscribe({ error: outcome });
        putRequest.error(failure);

        expect(outcome).toHaveBeenCalledWith(failure);
        expect(messageAdd).not.toHaveBeenCalled();
        expect(refreshActiveProject).not.toHaveBeenCalled();
      });

      it('toasts, with no inline error, when a dismissal was requested (canClose asked) before the exit animation ended', async () => {
        const config = await openEditDrawer();
        const outcome = vi.fn();

        config.data.save({ legal_entity_name: 'Changed' }).subscribe({ error: outcome });
        // Escape, the backdrop and the header close all ask canClose first; the drawer is still subscribed until it is destroyed.
        expect(config.canClose()).toBe(true);
        putRequest.error(failure);

        expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Not saved' }));
        expect(outcome).not.toHaveBeenCalled();
        expect(drawerClosed.observed).toBe(true);
      });

      it('keeps the failure inline when no dismissal was requested and the drawer is open and subscribed', async () => {
        const config = await openEditDrawer();
        const outcome = vi.fn();
        const canClose = vi.spyOn(config, 'canClose');

        config.data.save({ legal_entity_name: 'Changed' }).subscribe({ error: outcome });
        putRequest.error(failure);

        expect(canClose).not.toHaveBeenCalled();
        expect(outcome).toHaveBeenCalledWith(failure);
        expect(messageAdd).not.toHaveBeenCalled();
      });

      it('starts every open undismissed, so a dismissed earlier drawer does not toast a later inline failure', async () => {
        const first = await openEditDrawer();
        first.canClose();
        const button = fixture.nativeElement.querySelector('[data-testid="formation-card-edit-button"] button') as HTMLButtonElement;
        button.click();
        const second = openDrawer.mock.calls[1][1] as DrawerConfig;
        const outcome = vi.fn();

        second.data.save({ legal_entity_name: 'Changed' }).subscribe({ error: outcome });
        putRequest.error(failure);

        expect(outcome).toHaveBeenCalledWith(failure);
        expect(messageAdd).not.toHaveBeenCalled();
      });

      it('toasts when the drawer stopped listening before it finished closing', async () => {
        const config = await openEditDrawer();
        const outcome = vi.fn();

        config.data.save({ legal_entity_name: 'Changed' }).subscribe({ error: outcome }).unsubscribe();
        putRequest.error(failure);

        expect(outcome).not.toHaveBeenCalled();
        expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Not saved' }));
      });

      it('toasts when the drawer has closed', async () => {
        const config = await openEditDrawer();

        config.data.save({ legal_entity_name: 'Changed' }).subscribe({ error: () => undefined });
        drawerClosed.next(undefined);
        putRequest.error(failure);

        expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
      });

      it('toasts when the card is destroyed and the drawer closed before the write settled', async () => {
        const config = await openEditDrawer();

        // A live subscriber stays attached, so only the closure flag recorded after teardown can route this to the toast.
        config.data.save({ legal_entity_name: 'Changed' }).subscribe({ error: () => undefined });
        fixture.destroy();
        drawerClosed.next(undefined);
        putRequest.error(failure);

        expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
        expect(refreshActiveProject).not.toHaveBeenCalled();
      });
    });

    it('renders the sub-stage, announcement date and slug from the response, never from the project context', async () => {
      await renderWithInput(formation());

      expect(text()).toContain('Engaged');
      expect(text()).toContain('Oct 25, 2026');
      expect(text()).toContain('child-project');
      expect(text()).not.toContain('project-one');
    });

    // The admin-tool link is the one cross-project field the card resolves itself, and the only
    // one that can leak an identity: both probes key off `FormationCardView.uid`, which in input
    // mode comes from `parent_project_uid`. A regression to `uid: null` would hide the link rather
    // than fail, so the whole chain (uid -> auditor probe -> SFID -> href) is asserted here — this
    // is the mixing hazard #2719 exists for, and the other input-mode specs stub the SFID to null.
    it('resolves the admin-tool link from the response uid — the CHILD project, not the context', async () => {
      await renderWithInput(formation(), { sfid: 'child-sfid', auditor: true });

      expect(getProjectSpy).toHaveBeenCalledWith('child-uid', false, { auditor: true });
      expect(getProjectSfidSpy).toHaveBeenCalledWith('child-uid');
      expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-tool-link"]').getAttribute('href')).toBe(
        'https://pcc.dev.platform.linuxfoundation.org/project/child-sfid'
      );
    });

    it('hides the admin-tool link when the response carries no uid, instead of probing the wrong project', async () => {
      await renderWithInput(formation({ parent_project_uid: undefined }), { sfid: 'child-sfid', auditor: true });

      expect(getProjectSpy).not.toHaveBeenCalled();
      expect(getProjectSfidSpy).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).toBeNull();
    });

    it('falls back to "Not set" when the response carries no announcement date, without the loading or error states', async () => {
      // The BFF degrades a failed (auditor-gated) settings read to null rather than failing the
      // checklist, so a null date here is an expected value, not an error — and nothing is still
      // in flight, because the date arrived with the response.
      await renderWithInput(formation({ announcement_date: null }));

      expect(text()).toContain('Not set');
      expect(fixture.nativeElement.querySelector('[data-testid="formation-card-error"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('p-skeleton')).toBeNull();
    });

    it('omits the sub-stage pill when the raw stage is not a Formation sub-stage', async () => {
      await renderWithInput(formation({ sub_stage_raw: 'Active' }));

      expect(fixture.nativeElement.querySelector('[data-testid="formation-card"]')).not.toBeNull();
      expect(text()).not.toContain('Engaged');
    });
  });

  it('shows the error state when the settings fetch fails, without hiding data that already loaded (the sub-stage pill, slug, and admin links)', async () => {
    await render('Formation - Engaged', true, { settingsResult: throwError(() => new Error('network error')) });

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-error"]')).not.toBeNull();
    expect(text()).toContain('Engaged');
    expect(text()).toContain('project-one');
    // Admin links depend on isAuditor/sfid, not on the failed settings fetch — they must still show.
    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).not.toBeNull();
  });
});

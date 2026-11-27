// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import type { Meeting, MeetingWriteAccess, UiToastConfig } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { IntercomService } from '@services/intercom.service';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { MeetingComposerHostComponent } from '../meeting-composer-host.component';
import { MeetingComposerService } from '../meeting-composer.service';

describe('MeetingComposerModalComponent (through the host, meetings-redesign on)', () => {
  let fixture: ComponentFixture<MeetingComposerHostComponent>;
  let composer: MeetingComposerService;
  let formService: MeetingComposerFormService;
  let getMeeting: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn> };
  let deleteMeeting: ReturnType<typeof vi.fn>;
  let cancelOccurrence: ReturnType<typeof vi.fn>;

  const meeting = {
    id: 'meeting-1',
    title: 'Weekly sync',
    organizer: true,
    start_time: '2030-01-08T15:00:00Z',
    duration: 60,
    timezone: 'UTC',
    project_name: 'Acme Project',
  } as Meeting;

  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (testId: string): HTMLButtonElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`);

  const lastToast = (): UiToastConfig => toast.show.mock.calls[toast.show.mock.calls.length - 1][0];
  // The last match: a dialog closed earlier in the test can still be leaving the overlay container.
  const fromDocument = (testId: string): HTMLButtonElement | null => {
    const matches = document.querySelectorAll<HTMLButtonElement>(`[data-testid="${testId}"] button`);
    return matches[matches.length - 1] ?? null;
  };
  const pressEscape = (): void => {
    query('meeting-composer-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };

  const openEdit = async (patch: Partial<Meeting> = {}, occurrenceId?: string): Promise<void> => {
    getMeeting.mockReturnValue(of({ ...meeting, ...patch }));
    composer.open({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1', ...(occurrenceId ? { occurrenceId } : {}) });
    await flush();
  };

  beforeEach(async () => {
    getMeeting = vi.fn(() => of(meeting));
    toast = { show: vi.fn(() => ({ id: 'toast', dismiss: vi.fn() })) };
    deleteMeeting = vi.fn(() => of(undefined));
    cancelOccurrence = vi.fn(() => of(undefined));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        MessageService,
        { provide: CommitteeService, useValue: { getCommittees: vi.fn(() => of([])) } },
        {
          provide: MeetingService,
          useValue: {
            getMeeting,
            getMeetingAttachments: vi.fn(() => of([])),
            getMeetingRegistrants: vi.fn(() => of([])),
            getMeetingDetail: vi.fn(() => of(null)),
            deleteMeeting,
            cancelOccurrence,
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            meetingWriteAccess: signal<MeetingWriteAccess>({ contextUid: 'project-1', canWrite: true }),
            canWriteMeetings: signal(true),
            activeContextUid: signal('project-1'),
            activeContext: signal({ uid: 'project-1', name: 'Acme Project', slug: 'acme' }),
          },
        },
        { provide: UiToastService, useValue: toast },
        { provide: UserService, useValue: { refreshUserMeetings: vi.fn(), refreshUserPastMeetings: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true) } },
        { provide: PersonaService, useValue: { currentPersona: signal('maintainer') } },
        { provide: ProjectService, useValue: {} },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: LensService, useValue: { clearContextLens: vi.fn() } },
        { provide: IntercomService, useValue: { setLauncherHidden: vi.fn() } },
        { provide: Router, useValue: { events: new Subject(), url: '/meetings', parseUrl: () => ({ queryParams: {} }) } },
      ],
    });
    TestBed.overrideComponent(MeetingComposerHostComponent, { add: { providers: [] } });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(MeetingComposerHostComponent);
    composer = TestBed.inject(MeetingComposerService);
    formService = fixture.debugElement.injector.get(MeetingComposerFormService);
    await flush();
  });

  it('renders nothing while the composer is closed', () => {
    expect(query('meeting-composer-modal')).toBeNull();
  });

  describe('create', () => {
    beforeEach(async () => {
      composer.open({ mode: 'create', projectUid: 'project-1' });
      await flush();
    });

    it('opens the modal instead of the drawer, titled with the project above it', () => {
      expect(query('meeting-composer-dialog')?.getAttribute('role')).toBe('dialog');
      expect(document.querySelector('.p-drawer')).toBeNull();
      expect(text('meeting-composer-title')).toBe('Create meeting');
      expect(text('meeting-composer-project')).toContain('Acme Project');
    });

    it('heads the section with its title and description, and the mobile header with the step', () => {
      expect(text('meeting-composer-section-header')).toContain('Details & Access');
      expect(text('meeting-composer-section-header')).toContain('Name the meeting, pick its type and decide who can find and join it.');
      expect(text('meeting-composer-mobile-step')).toBe('Step 1 of 5 · Details & Access');
    });

    it('starts with recording and AI summary on, without marking the create dirty', () => {
      expect(formService.form().get('recording_enabled')?.value).toBe(true);
      expect(formService.form().get('zoom_ai_enabled')?.value).toBe(true);

      pressEscape();

      expect(composer.isOpen()).toBe(false);
    });

    it('locks every step after an invalid required section', () => {
      expect(query('meeting-composer-rail-date-schedule')?.getAttribute('aria-disabled')).toBe('true');
      expect(query('meeting-composer-rail-guests')?.getAttribute('aria-disabled')).toBe('true');

      query('meeting-composer-rail-guests')?.click();

      expect(composer.activeSection()).toBe('details-access');
    });

    it('unlocks the optional steps together once both required sections are valid', async () => {
      formService.form().patchValue({
        title: 'Weekly sync',
        meeting_type: 'Technical',
        startDate: new Date(2030, 0, 8),
        startTime: '10:00 AM',
        timezone: 'America/New_York',
      });
      await flush();

      expect(query('meeting-composer-rail-guests')?.getAttribute('aria-disabled')).toBeNull();
      query('meeting-composer-rail-agenda-resources')?.click();
      await flush();

      expect(composer.activeSection()).toBe('agenda-resources');
      expect(button('meeting-composer-create')).not.toBeNull();
      expect(button('meeting-composer-back')).not.toBeNull();
    });

    it('keeps Next disabled until the section is valid, then advances', async () => {
      expect(button('meeting-composer-next')?.disabled).toBe(true);

      formService.form().patchValue({ title: 'Weekly sync', meeting_type: 'Technical' });
      await flush();
      button('meeting-composer-next')?.click();
      await flush();

      expect(composer.activeSection()).toBe('date-schedule');
      expect(text('meeting-composer-mobile-step')).toBe('Step 2 of 5 · Date & schedule');
    });

    it('asks before discarding entered work, and keeps editing when told to', async () => {
      formService.form().patchValue({ title: 'Weekly sync' });
      await flush();

      button('meeting-composer-close')?.click();
      await flush();

      expect(document.querySelector('[data-testid="meeting-composer-discard-dialog"]')?.textContent).toContain('Discard this meeting?');
      fromDocument('meeting-composer-discard-keep')?.click();
      await flush();

      expect(composer.isOpen()).toBe(true);
      expect(document.querySelector('[data-testid="meeting-composer-discard-dialog"]')).toBeNull();
    });

    it('closes once the organizer discards from Cancel', async () => {
      formService.form().patchValue({ title: 'Weekly sync' });
      await flush();

      button('meeting-composer-cancel')?.click();
      await flush();
      fromDocument('meeting-composer-discard-confirm')?.click();
      await flush();

      expect(composer.isOpen()).toBe(false);
    });

    it('asks from Escape too', async () => {
      formService.form().patchValue({ title: 'Weekly sync' });
      await flush();

      pressEscape();
      await flush();
      fromDocument('meeting-composer-discard-confirm')?.click();
      await flush();

      expect(composer.isOpen()).toBe(false);
    });

    it('announces a create with a dark toast offering View meeting and Edit', async () => {
      vi.spyOn(formService, 'validateForSubmit').mockReturnValue(true);
      vi.spyOn(formService, 'submit').mockReturnValue(of({ ...meeting, timezone: 'America/Los_Angeles', start_time: '2026-10-06T16:00:00Z' }));

      fixture.debugElement.componentInstance['onSubmit']();
      await flush();

      expect(lastToast()).toMatchObject({ variant: 'dark', message: 'Meeting created', description: '“Weekly sync” · Tue, Oct 6, 2026 at 9:00 AM' });
      expect(lastToast().position).toBeUndefined();
      expect(lastToast().actions?.map((action) => action.label)).toEqual(['View meeting', 'Edit']);
    });

    it('treats a type picked from the create menu as a starting point, not entered work', async () => {
      composer.open({ mode: 'create', projectUid: 'project-1', meetingType: 'Technical' as never });
      await flush();

      button('meeting-composer-close')?.click();
      await flush();

      expect(composer.isOpen()).toBe(false);
    });

    it('closes untouched without asking', async () => {
      button('meeting-composer-close')?.click();
      expect(composer.isOpen()).toBe(false);

      composer.open({ mode: 'create', projectUid: 'project-1' });
      await flush();
      button('meeting-composer-cancel')?.click();
      expect(composer.isOpen()).toBe(false);

      composer.open({ mode: 'create', projectUid: 'project-1' });
      await flush();
      pressEscape();
      expect(composer.isOpen()).toBe(false);
      expect(document.querySelector('[data-testid="meeting-composer-discard-dialog"]')).toBeNull();
    });

    it('leaves Escape to an open overlay or an input method composition', async () => {
      const trigger = document.createElement('button');
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('role', 'combobox');
      query('meeting-composer-body')?.appendChild(trigger);

      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      query('meeting-composer-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));

      expect(composer.isOpen()).toBe(true);
      expect(query('meeting-composer-dialog')?.hasAttribute('aria-modal')).toBe(false);
    });

    it('stays open on Escape while a save is in flight', async () => {
      formService.submitting.set(true);
      await flush();

      query('meeting-composer-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(composer.isOpen()).toBe(true);
      expect(query('meeting-composer-body')?.hasAttribute('inert')).toBe(true);
    });
  });

  it('opens a quick create in the modal too', async () => {
    composer.open({ mode: 'create', variant: 'quick', projectUid: 'project-1' });
    await flush();

    expect(query('meeting-composer-dialog')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('lfx-quick-create-dialog')).toBeNull();
  });

  it('names no project while the open context is another project', async () => {
    composer.open({ mode: 'create', projectUid: 'project-2' });
    await flush();

    expect(query('meeting-composer-project')).toBeNull();
  });

  describe('edit', () => {
    it('drops the rail rows and the preview when the meeting fails to load', async () => {
      getMeeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      composer.open({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });
      await flush();

      expect(query('meeting-composer-load-error')).not.toBeNull();
      expect(query('meeting-composer-rail-details-access')).toBeNull();
      expect(query('meeting-composer-preview-column')).toBeNull();
      expect(query('meeting-composer-mobile-section')).toBeNull();
    });

    it('names no project and marks every section seen while an edit loads', async () => {
      getMeeting.mockReturnValue(new Subject());
      composer.open({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });
      await flush();

      expect(query('meeting-composer-project')).toBeNull();
      expect(composer.visitedSections().size).toBe(5);
    });

    it('lists every section, offers Cancel and Save on the right, and names a one-time meeting', async () => {
      await openEdit();

      expect(text('meeting-composer-title')).toBe('Edit meeting');
      expect(query('meeting-composer-rail-platform-features')?.getAttribute('aria-disabled')).toBeNull();
      expect(query('meeting-composer-mobile-step')).toBeNull();
      expect(query('meeting-composer-mobile-section')).not.toBeNull();
      expect(button('meeting-composer-save')).not.toBeNull();
      expect(button('meeting-composer-next')).toBeNull();
      expect(text('meeting-composer-scope-single')).toContain('One-time meeting');
      expect(text('meeting-composer-scope-single')).toContain('Weekly sync');
    });

    it('asks before discarding edits with the edit copy', async () => {
      await openEdit();
      formService.form().patchValue({ title: 'Renamed sync' });
      await flush();

      button('meeting-composer-cancel')?.click();
      await flush();

      expect(document.querySelector('[data-testid="meeting-composer-discard-dialog"]')?.textContent).toContain('Discard your changes?');
      fromDocument('meeting-composer-discard-confirm')?.click();
      await flush();
      expect(composer.isOpen()).toBe(false);
    });

    it('closes an unchanged edit without asking, and offers no Cancel occurrence outside occurrence scope', async () => {
      await openEdit();

      expect(button('meeting-composer-cancel-occurrence')).toBeNull();
      button('meeting-composer-cancel')?.click();
      await flush();

      expect(composer.isOpen()).toBe(false);
    });

    it('confirms a saved one-time meeting with its new date', async () => {
      await openEdit();
      vi.spyOn(formService, 'validateForSubmit').mockReturnValue(true);
      vi.spyOn(formService, 'submit').mockReturnValue(of(null));
      formService.form().patchValue({ title: 'Renamed sync', startDate: new Date(2030, 0, 8), startTime: '10:00 AM', timezone: 'UTC' });

      fixture.debugElement.componentInstance['onSubmit']();
      await flush();

      expect(lastToast()).toMatchObject({ variant: 'dark', message: 'Meeting updated', description: '“Renamed sync” · Tue, Jan 8, 2030 at 10:00 AM' });
    });

    it('deletes a one-time meeting after confirming, then closes with a toast', async () => {
      await openEdit({ registrant_count: 3 });

      button('meeting-composer-delete')?.click();
      await flush();

      const details = document.querySelector('[data-testid="meeting-composer-delete-details"]')?.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(details).toContain('Title:Weekly sync');
      expect(details).toContain('Date:Tue, Jan 8, 2030');
      expect(details).toContain('Guests:3 guests');
      expect(document.querySelector('[data-testid="meeting-composer-delete-dialog"] [data-testid="ui-modal-subtitle"]')?.textContent).toContain(
        'This permanently deletes the meeting.'
      );

      fromDocument('meeting-composer-delete-confirm')?.click();
      await flush();

      expect(deleteMeeting).toHaveBeenCalledWith('meeting-1');
      expect(lastToast()).toMatchObject({ variant: 'dark', message: 'Meeting deleted', description: '“Weekly sync” · 3 guests notified' });
      expect(composer.isOpen()).toBe(false);
      expect(composer.saveCount()).toBe(1);
    });

    it('cannot be dismissed while the delete request runs', async () => {
      const request = new Subject<void>();
      deleteMeeting.mockReturnValue(request);
      await openEdit();

      button('meeting-composer-delete')?.click();
      await flush();
      fromDocument('meeting-composer-delete-confirm')?.click();
      await flush();
      document.querySelector('[data-testid="meeting-composer-delete-dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();

      expect(document.querySelectorAll('[data-testid="meeting-composer-delete-dialog"]').length).toBeGreaterThan(0);
      expect(composer.isOpen()).toBe(true);

      request.next();
      request.complete();
      await flush();
      expect(composer.isOpen()).toBe(false);
    });

    it('still reports a delete that settles after the composer closed', async () => {
      const request = new Subject<void>();
      deleteMeeting.mockReturnValue(request);
      await openEdit({ registrant_count: 3 });

      button('meeting-composer-delete')?.click();
      await flush();
      fromDocument('meeting-composer-delete-confirm')?.click();
      await flush();
      composer.close();
      await flush();

      request.next();
      request.complete();
      await flush();

      expect(lastToast()).toMatchObject({ variant: 'dark', message: 'Meeting deleted', description: '“Weekly sync” · 3 guests notified' });
      expect(composer.saveCount()).toBe(1);
    });

    it('leaves a composer opened since for another meeting open when a late delete lands', async () => {
      const request = new Subject<void>();
      deleteMeeting.mockReturnValue(request);
      await openEdit();

      button('meeting-composer-delete')?.click();
      await flush();
      fromDocument('meeting-composer-delete-confirm')?.click();
      await flush();
      composer.close();
      await flush();
      getMeeting.mockReturnValue(of({ ...meeting, id: 'meeting-2', title: 'Other sync' }));
      composer.open({ mode: 'edit', meetingUid: 'meeting-2', projectUid: 'project-1' });

      request.next();
      request.complete();
      await flush();

      expect(lastToast()).toMatchObject({ message: 'Meeting deleted' });
      expect(composer.isOpen()).toBe(true);
      expect(composer.context()?.meetingUid).toBe('meeting-2');
    });

    it('closes a composer reopened on the deleted meeting when the late delete lands', async () => {
      const request = new Subject<void>();
      deleteMeeting.mockReturnValue(request);
      await openEdit();

      button('meeting-composer-delete')?.click();
      await flush();
      fromDocument('meeting-composer-delete-confirm')?.click();
      await flush();
      composer.close();
      await flush();
      composer.open({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });

      request.next();
      request.complete();
      await flush();

      expect(composer.isOpen()).toBe(false);
    });

    it('keeps the meeting and the composer when the organizer backs out of the delete', async () => {
      await openEdit();

      button('meeting-composer-delete')?.click();
      await flush();
      fromDocument('meeting-composer-delete-keep')?.click();
      await flush();

      expect(deleteMeeting).not.toHaveBeenCalled();
      expect(composer.isOpen()).toBe(true);
    });

    it('says a recurring edit applies to the whole series', async () => {
      await openEdit({ recurrence: { type: 2, repeat_interval: 1 } as Meeting['recurrence'] });

      expect(text('meeting-composer-scope-series')).toContain('Changes apply to every upcoming occurrence.');
      expect(button('meeting-composer-delete')).toBeNull();

      vi.spyOn(formService, 'validateForSubmit').mockReturnValue(true);
      vi.spyOn(formService, 'submit').mockReturnValue(of(null));
      fixture.debugElement.componentInstance['onSubmit']();
      await flush();

      expect(lastToast()).toMatchObject({
        variant: 'dark',
        message: 'Series updated',
        description: '“Weekly sync” · changes apply to every upcoming occurrence',
      });
    });

    it('cancels the occurrence from the footer, then closes and refreshes the page', async () => {
      await openEdit(
        {
          recurrence: { type: 2, repeat_interval: 1 } as Meeting['recurrence'],
          meeting_type: 'Technical',
          occurrences: [{ occurrence_id: '1894114800', start_time: '2030-01-09T15:00:00Z', duration: 60 }],
        } as Partial<Meeting>,
        '1894114800'
      );

      button('meeting-composer-cancel-occurrence')?.click();
      await flush();
      fromDocument('meetings-home-delete-confirm')?.click();
      await flush();

      expect(cancelOccurrence).toHaveBeenCalledWith('meeting-1', '1894114800', undefined);
      expect(composer.isOpen()).toBe(false);
      expect(composer.saveCount()).toBe(1);
    });

    it('notes what an occurrence edit leaves out and reopens the series on the same section', async () => {
      await openEdit(
        {
          recurrence: { type: 2, repeat_interval: 1 } as Meeting['recurrence'],
          meeting_type: 'Technical',
          occurrences: [{ occurrence_id: '1894114800', start_time: '2030-01-09T15:00:00Z', duration: 60 }],
        },
        '1894114800'
      );
      composer.setSection('date-schedule');
      await flush();

      expect(text('meeting-composer-series-fields-note')).toContain('Timezone, early join and how often the meeting repeats');
      expect(query('meeting-composer-rail-platform-features')).toBeNull();
      expect(button('meeting-composer-cancel-occurrence')).not.toBeNull();

      query('meeting-composer-series-fields-edit-series')?.click();
      await flush();

      expect(composer.context()).toEqual({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1', section: 'date-schedule' });
    });
  });
});

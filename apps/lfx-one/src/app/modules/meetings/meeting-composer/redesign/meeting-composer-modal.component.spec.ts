// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import type { Meeting, MeetingWriteAccess } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { IntercomService } from '@services/intercom.service';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
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

  const openEdit = async (patch: Partial<Meeting> = {}, occurrenceId?: string): Promise<void> => {
    getMeeting.mockReturnValue(of({ ...meeting, ...patch }));
    composer.open({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1', ...(occurrenceId ? { occurrenceId } : {}) });
    await flush();
  };

  beforeEach(async () => {
    getMeeting = vi.fn(() => of(meeting));

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

    it('closes from the X, Cancel and Escape', async () => {
      button('meeting-composer-close')?.click();
      expect(composer.isOpen()).toBe(false);

      composer.open({ mode: 'create', projectUid: 'project-1' });
      await flush();
      button('meeting-composer-cancel')?.click();
      expect(composer.isOpen()).toBe(false);

      composer.open({ mode: 'create', projectUid: 'project-1' });
      await flush();
      query('meeting-composer-dialog')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(composer.isOpen()).toBe(false);
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

    it('says a recurring edit applies to the whole series', async () => {
      await openEdit({ recurrence: { type: 2, repeat_interval: 1 } as Meeting['recurrence'] });

      expect(text('meeting-composer-scope-series')).toContain('Changes apply to every upcoming occurrence.');
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

      query('meeting-composer-series-fields-edit-series')?.click();
      await flush();

      expect(composer.context()).toEqual({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1', section: 'date-schedule' });
    });
  });
});

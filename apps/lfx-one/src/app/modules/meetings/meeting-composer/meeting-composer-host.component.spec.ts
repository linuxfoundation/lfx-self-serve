// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MEETING_COMPOSER_SECTIONS, MEETING_COMPOSER_TOAST_KEY } from '@lfx-one/shared/constants';
import type { Meeting } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerHostComponent } from './meeting-composer-host.component';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * Covers the host's own decisions: which section the footer navigation lands on, when Save is allowed
 * to fire, what the post-create toast carries, and the two ways an open composer closes without the
 * organizer asking. None of it is reachable from the section specs — the host is the only place that
 * holds both composer services, and its `submit()` subscription is the single path between a saved
 * meeting and the toast that is now the only route back to it.
 */
describe('MeetingComposerHostComponent', () => {
  let fixture: ComponentFixture<MeetingComposerHostComponent>;
  let component: MeetingComposerHostComponent;
  let composer: MeetingComposerService;
  let formService: MeetingComposerFormService;
  let messageService: { add: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  let canWrite: WritableSignal<boolean>;
  let canWriteMeetings: WritableSignal<boolean>;

  const createdMeeting = { id: 'meeting-1', title: 'Weekly sync' } as Meeting;

  /** The `toObservable` bridges in the constructor emit on effect flush, so every signal write needs one. */
  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const openCreate = async (): Promise<void> => {
    composer.open({ mode: 'create', projectUid: 'project-1' });
    await flush();
  };

  /** The smallest set that satisfies every required control plus the group-level future-date validator. */
  const fillRequiredFields = (): void => {
    formService.form().patchValue({
      title: 'Weekly sync',
      meeting_type: 'Technical',
      startDate: new Date(2030, 0, 8),
      // `combineDateTime` parses a 12-hour string only; a 24-hour one returns '' and the validator passes
      // for the wrong reason.
      startTime: '10:00 AM',
      timezone: 'America/New_York',
    });
  };

  const lastToast = () => messageService.add.mock.calls[messageService.add.mock.calls.length - 1][0];

  beforeEach(async () => {
    messageService = { add: vi.fn(), clear: vi.fn() };
    canWrite = signal(false);
    canWriteMeetings = signal(true);

    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: messageService },
        { provide: CommitteeService, useValue: {} },
        {
          provide: MeetingService,
          useValue: {
            getMeeting: vi.fn(() => of({ id: 'meeting-1', title: 'Weekly sync', start_time: '2030-01-08T15:00:00Z', timezone: 'America/New_York' })),
            getMeetingAttachments: vi.fn(() => of([])),
            getMeetingRegistrants: vi.fn(() => of([])),
            getMeetingDetail: vi.fn(() => of(null)),
          },
        },
        // `canWrite` is fed to `toObservable`, so it has to be a real signal rather than a plain getter.
        { provide: ProjectContextService, useValue: { canWrite, canWriteMeetings, activeContextUid: () => '' } },
        // Only reached by the project-context fallback, which never runs while no meeting is loaded.
        { provide: ProjectService, useValue: {} },
        { provide: Router, useValue: { events: new Subject(), url: '/meetings', parseUrl: () => ({ queryParams: {} }) } },
      ],
    });
    // `set` replaces only the listed metadata keys, so the component's own `providers` survive and the
    // host still supplies the form service instance the tests read below.
    TestBed.overrideComponent(MeetingComposerHostComponent, { set: { template: '', imports: [] } });

    fixture = TestBed.createComponent(MeetingComposerHostComponent);
    component = fixture.componentInstance;
    composer = TestBed.inject(MeetingComposerService);
    // Component-provided, so `TestBed.inject` would hand back a second instance the host never reads.
    formService = fixture.debugElement.injector.get(MeetingComposerFormService);
    await flush();
  });

  describe('section navigation', () => {
    it('tracks the active section by position', () => {
      composer.setSection('platform-features');

      expect(component['activeIndex']()).toBe(2);
      expect(component['isLastSection']()).toBe(false);
      expect(component['activeSectionLabel']()).toBe('Platform & features');
    });

    it('reports the final section as last', () => {
      composer.setSection('agenda-resources');

      expect(component['isLastSection']()).toBe(true);
    });

    it('advances one section and records the visit', () => {
      component['onNext']();

      expect(composer.activeSection()).toBe(MEETING_COMPOSER_SECTIONS[1].id);
      expect(composer.visitedSections().has(MEETING_COMPOSER_SECTIONS[1].id)).toBe(true);
    });

    it('does nothing when Next is reached on the last section', () => {
      composer.setSection('agenda-resources');

      component['onNext']();

      // The footer hides Next here, but the handler is also the keyboard path — walking off the end
      // would leave `activeIndex` at -1 and blank the header label.
      expect(composer.activeSection()).toBe('agenda-resources');
    });

    it('steps back one section', () => {
      composer.setSection('date-schedule');

      component['onBack']();

      expect(composer.activeSection()).toBe('details-access');
    });

    it('does nothing when Back is pressed on the first section', () => {
      component['onBack']();

      expect(composer.activeSection()).toBe('details-access');
    });

    it('jumps to the section that owns the title field', () => {
      composer.setSection('guests');

      component['onGoToTitleSection']();

      expect(composer.activeSection()).toBe('details-access');
    });
  });

  describe('closing', () => {
    it('closes the composer when the drawer reports itself hidden', async () => {
      await openCreate();

      component['onVisibleChange'](false);

      expect(composer.isOpen()).toBe(false);
    });

    it('leaves the composer open when the drawer reports itself visible', async () => {
      await openCreate();

      component['onVisibleChange'](true);

      expect(composer.isOpen()).toBe(true);
    });

    it('closes an open composer when write access is lost', async () => {
      canWrite.set(true);
      await flush();
      await openCreate();

      canWrite.set(false);
      await flush();

      expect(composer.isOpen()).toBe(false);
    });

    it('leaves the composer open when write access only resolves late', async () => {
      await openCreate();

      // `canWrite` starts false and stays false while the grants request is unresolved, so a deep-linked
      // open would be closed under the organizer if any false counted rather than only a true -> false.
      canWrite.set(true);
      await flush();

      expect(composer.isOpen()).toBe(true);
    });
  });

  describe('submit gating', () => {
    it('blocks save while the create form is empty', async () => {
      await openCreate();

      expect(component['canSubmit']()).toBe(false);
    });

    it('allows save once every required field is answered', async () => {
      await openCreate();

      fillRequiredFields();

      expect(component['canSubmit']()).toBe(true);
    });

    it('ignores a submit while one is already in flight', async () => {
      await openCreate();
      const submit = vi.spyOn(formService, 'submit');
      formService.submitting.set(true);

      component['onSubmit']();

      expect(submit).not.toHaveBeenCalled();
    });

    it('ignores a submit the form validation rejects', async () => {
      await openCreate();
      const submit = vi.spyOn(formService, 'submit');
      vi.spyOn(formService, 'validateForSubmit').mockReturnValue(false);

      component['onSubmit']();

      expect(submit).not.toHaveBeenCalled();
    });
  });

  describe('post-create announcement', () => {
    beforeEach(async () => {
      await openCreate();
      vi.spyOn(formService, 'validateForSubmit').mockReturnValue(true);
    });

    it('raises a sticky keyed toast carrying the created meeting', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(createdMeeting));

      component['onSubmit']();

      expect(lastToast()).toMatchObject({
        key: MEETING_COMPOSER_TOAST_KEY,
        severity: 'success',
        summary: 'Meeting created',
        detail: 'Weekly sync',
        sticky: true,
        closable: true,
        data: { meetingUid: 'meeting-1', meetingTitle: 'Weekly sync', meetingUrl: '/meetings/meeting-1', meetingQueryParams: {} },
      });
    });

    it('retires the previous announcement before raising its own', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(createdMeeting));

      component['onSubmit']();

      // Sticky toasts never expire, so creating several meetings in a row would stack them over the page.
      expect(messageService.clear).toHaveBeenCalledWith(MEETING_COMPOSER_TOAST_KEY);
    });

    it('carries the password to the meeting link when the meeting has one', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of({ ...createdMeeting, password: 'secret' } as Meeting));

      component['onSubmit']();

      // Without it the join page bounces every private or restricted meeting to /meetings/not-found.
      expect(lastToast().data.meetingQueryParams).toEqual({ password: 'secret' });
    });

    it('names an untitled meeting rather than showing a blank toast', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of({ id: 'meeting-2' } as Meeting));

      component['onSubmit']();

      expect(lastToast().data.meetingTitle).toBe('Untitled meeting');
    });

    it('falls back to a plain confirmation when the create returns no meeting', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(null));

      component['onSubmit']();

      // A keyed toast here would offer two actions that dead-end: there is no uid to link to.
      expect(lastToast()).toEqual({ severity: 'success', summary: 'Meeting created', detail: 'Open it from the list to review the details.' });
      expect(lastToast().key).toBeUndefined();
    });

    it('confirms an edit instead of announcing a creation', () => {
      formService.mode.set('edit');
      vi.spyOn(formService, 'submit').mockReturnValue(of(null));

      component['onSubmit']();

      expect(lastToast()).toMatchObject({ summary: 'Meeting updated', detail: 'Your changes have been saved.' });
    });

    it('records the save and closes the composer', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(createdMeeting));

      component['onSubmit']();

      expect(composer.saveCount()).toBe(1);
      expect(composer.isOpen()).toBe(false);
    });

    it('acts once even if the save stream emits again', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(createdMeeting, { id: 'meeting-2' } as Meeting));

      component['onSubmit']();

      // The handler closes the composer, so a second emission would announce a meeting over a surface
      // that has already moved on.
      expect(messageService.add).toHaveBeenCalledTimes(1);
      expect(composer.saveCount()).toBe(1);
    });
  });

  describe('editing from the toast', () => {
    it('refuses while another composer is open', async () => {
      await openCreate();

      expect(component['editFromToastBlockedReason']()).toBe('Close the open composer first');
    });

    it('allows the reopen once the composer is closed', () => {
      expect(component['editFromToastBlockedReason']()).toBeNull();
    });

    it('refuses once meeting-write access is gone', () => {
      canWriteMeetings.set(false);

      expect(component['editFromToastBlockedReason']()).toBe('You no longer have write access');
    });

    it('does nothing when the action is blocked', async () => {
      await openCreate();

      component['onEditCreatedMeeting']({ meetingUid: 'meeting-1', meetingTitle: 'Weekly sync', meetingUrl: '/meetings/meeting-1', meetingQueryParams: {} });

      // Reopening here would silently discard the draft in the open composer.
      expect(composer.context()).toMatchObject({ mode: 'create' });
    });

    it('clears the toast and reopens the composer in edit mode', () => {
      component['onEditCreatedMeeting']({ meetingUid: 'meeting-1', meetingTitle: 'Weekly sync', meetingUrl: '/meetings/meeting-1', meetingQueryParams: {} });

      expect(messageService.clear).toHaveBeenCalledWith(MEETING_COMPOSER_TOAST_KEY);
      expect(composer.context()).toEqual({ mode: 'edit', meetingUid: 'meeting-1' });
    });
  });

  describe('switching a quick create to the drawer', () => {
    it('drops the quick-create defaults before moving surfaces', async () => {
      composer.open({ mode: 'create', projectUid: 'project-1', variant: 'quick' });
      await flush();
      const dropDefaults = vi.spyOn(formService, 'dropQuickCreateDefaults');

      component['onSwitchToAdvanced']();

      // Order matters only in that both run: the drawer must stop rewriting fields the organizer
      // already answered in the dialog.
      expect(dropDefaults).toHaveBeenCalledOnce();
      expect(composer.isQuickCreate()).toBe(false);
    });
  });
});

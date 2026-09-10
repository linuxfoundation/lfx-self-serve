// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MEETING_TEMPLATES } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerService } from './meeting-composer.service';
import { QuickCreateDialogComponent } from './quick-create-dialog.component';

/**
 * Covers the type-driven prefill, which is the only behavior this dialog owns that the drawer does not.
 *
 * The template is stubbed: the subject is the constructor's `meeting_type` subscription, and rendering
 * the real markup would pull in both composed sections and the committee manager for nothing.
 */
describe('QuickCreateDialogComponent', () => {
  let fixture: ComponentFixture<QuickCreateDialogComponent>;
  let formService: MeetingComposerFormService;
  let composer: MeetingComposerService;

  const selectType = (meetingType: MeetingType): void => {
    formService.form().get('meeting_type')?.setValue(meetingType);
  };
  const valueOf = (control: string): unknown => formService.form().get(control)?.value;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        MeetingComposerService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => null } },
      ],
    });
    TestBed.overrideComponent(QuickCreateDialogComponent, { set: { template: '', imports: [] } });

    composer = TestBed.inject(MeetingComposerService);
    composer.open({ mode: 'create', projectUid: 'project-1' });
    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(QuickCreateDialogComponent);
    fixture.detectChanges();
  });

  it('prefills the title and agenda from the picked type', () => {
    selectType(MeetingType.BOARD);

    expect(valueOf('title')).toBeTruthy();
    expect(valueOf('description')).toBeTruthy();
  });

  it('prefills nothing for Other, whose templates describe occasions rather than the type', () => {
    // Guards the skip rather than an empty shelf: `Other` does ship templates, reachable from the
    // agenda field's Templates popover — they just aren't a sane guess for a catch-all type.
    expect(MEETING_TEMPLATES.some((group) => group.meetingType === MeetingType.OTHER)).toBe(true);

    selectType(MeetingType.OTHER);

    expect(valueOf('title')).toBe('');
    expect(valueOf('description')).toBe('');
  });

  // The counterpart to the test above. Leaving the previous type's prefill standing put a Board title
  // and a Board agenda under a meeting typed `Other`, with the "Pre-filled for this meeting type" hint
  // gone — so nothing on screen said where the text had come from or that it no longer matched.
  it('takes the previous type prefill back out when the organizer switches to Other', () => {
    selectType(MeetingType.BOARD);
    expect(valueOf('description')).toBeTruthy();

    selectType(MeetingType.OTHER);

    expect(valueOf('title')).toBe('');
    expect(valueOf('description')).toBe('');
  });

  // The reason the clear is guarded on `pristine` rather than run unconditionally: once the organizer
  // has written in the field it is theirs, and switching type must not throw it away.
  it('keeps an edited agenda when the organizer switches to Other', () => {
    selectType(MeetingType.BOARD);
    formService.form().get('description')?.setValue('My own agenda');
    formService.form().get('description')?.markAsDirty();

    selectType(MeetingType.OTHER);

    expect(valueOf('description')).toBe('My own agenda');
  });

  it('keeps an edited title when the organizer switches to Other', () => {
    selectType(MeetingType.BOARD);
    formService.form().get('title')?.setValue('Q3 planning');
    formService.form().get('title')?.markAsDirty();

    selectType(MeetingType.OTHER);

    expect(valueOf('title')).toBe('Q3 planning');
  });

  it('replaces the previous type prefill rather than layering the new one over it', () => {
    selectType(MeetingType.BOARD);
    const boardTitle = valueOf('title');

    selectType(MeetingType.TECHNICAL);

    expect(valueOf('title')).not.toBe(boardTitle);
    expect(valueOf('title')).toBeTruthy();
  });
  // Duration is the seeded control the chip scale does not fit: Maintainers is the only type whose
  // first template estimates a span a chip offers, and every other one lands on 70 minutes. Both
  // routes are pinned below, each starting from a chip the seeding has to visibly overwrite.
  it('seeds a template estimate that sits on the chip scale', () => {
    formService.setDuration(30);

    selectType(MeetingType.MAINTAINERS);

    expect(formService.effectiveDuration()).toBe(60);
    expect(fixture.componentInstance['prefilledDuration']()).toBe(true);
  });

  it('routes an off-chip template estimate into the custom-minutes input', () => {
    formService.setDuration(30);

    // Technical's first template estimates 70 minutes, which no chip offers. Skipping those left
    // nearly every type sitting on the plain form default, so the estimate is seeded regardless and
    // `setDuration` puts it where an off-chip value belongs.
    selectType(MeetingType.TECHNICAL);

    expect(formService.effectiveDuration()).toBe(70);
    expect(valueOf('duration')).toBe('custom');
    expect(valueOf('customDuration')).toBe(70);
    expect(fixture.componentInstance['prefilledDuration']()).toBe(true);
  });

  // The value clears back to the same default it was seeded from, so the hint is the only thing that
  // moves — and the hint is the whole point: it claims the number came from the type.
  it('takes the duration hint back out when the organizer switches to Other', () => {
    selectType(MeetingType.MAINTAINERS);
    expect(fixture.componentInstance['prefilledDuration']()).toBe(true);

    selectType(MeetingType.OTHER);

    expect(fixture.componentInstance['prefilledDuration']()).toBe(false);
  });

  it('keeps a duration the organizer set themselves', () => {
    formService.setDuration(120);
    formService.form().get('duration')?.markAsDirty();

    selectType(MeetingType.MAINTAINERS);

    expect(formService.effectiveDuration()).toBe(120);
    expect(fixture.componentInstance['prefilledDuration']()).toBe(false);
  });

  it('closes the composer when the organizer dismisses the dialog', () => {
    composer.open({ mode: 'create', projectUid: 'project-1', variant: 'quick' });

    fixture.componentInstance['onVisibleChange'](false);

    expect(composer.isOpen()).toBe(false);
  });

  // The handoff to the drawer unmounts this dialog. An unmount that still routed through `close()`
  // would take the composer down with it, so the organizer would ask for the advanced surface and get
  // an empty screen — hence the variant guard rather than a bare `close()`.
  it('leaves the composer open when the dialog closes behind the drawer handoff', () => {
    composer.open({ mode: 'create', projectUid: 'project-1', variant: 'quick' });
    composer.switchToAdvanced();

    fixture.componentInstance['onVisibleChange'](false);

    expect(composer.isOpen()).toBe(true);
  });

  // Both footer actions are announcements, not the action itself: saving and surface-switching each
  // need the composer service and the form service held together, which only the host does.
  it('announces create rather than saving from the dialog', () => {
    const emitted = vi.fn();
    fixture.componentInstance.create.subscribe(emitted);

    fixture.componentInstance['onCreate']();

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('announces the drawer handoff rather than performing it', () => {
    const emitted = vi.fn();
    fixture.componentInstance.switchToAdvanced.subscribe(emitted);

    fixture.componentInstance['onSwitchToAdvanced']();

    expect(emitted).toHaveBeenCalledTimes(1);
  });
});

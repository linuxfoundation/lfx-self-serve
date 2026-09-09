// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AbstractControl } from '@angular/forms';
import { MEETING_AGENDA_PROMPT_MAX_LENGTH } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import type { MeetingTemplate } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Popover } from 'primeng/popover';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposerAgendaFieldComponent } from './composer-agenda-field.component';
import { MeetingComposerFormService } from './meeting-composer-form.service';

/**
 * Covers the AI helper's request guard, which is deliberately presence-only: the server truncates an
 * over-budget descriptor rather than rejecting it, so nothing that passes here can fail there for
 * length. A length check added on this side would re-open the dead end the truncation removed — an
 * over-budget title with no goal would be refused locally with no way for the organizer to fix it.
 *
 * Also pins `aiPrompt` staying validator-free. It is a scratch field that never reaches the save
 * payload, but it lives in the FormGroup `validateForSubmit()` reads over, so a validator here would
 * disable Save with no error UI to explain why.
 */
describe('ComposerAgendaFieldComponent — AI helper guard', () => {
  let fixture: ComponentFixture<ComposerAgendaFieldComponent>;
  let component: ComposerAgendaFieldComponent;
  let formService: MeetingComposerFormService;
  let generateAgenda: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  // The popover is only asked to close itself on success, so a hide-only stub is enough here.
  const popoverStub = { hide: vi.fn() } as unknown as Popover;
  const generate = (): void => component['onGenerateAgenda'](popoverStub);

  beforeEach(async () => {
    generateAgenda = vi.fn(() => of({ agenda: 'Roll call', estimatedDuration: 30 }));
    messageAdd = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: { generateAgenda } },
        { provide: ProjectContextService, useValue: { activeContext: () => null, activeContextUid: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => null } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(ComposerAgendaFieldComponent, { set: { template: '', imports: [] } });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerAgendaFieldComponent);
    fixture.componentRef.setInput('form', formService.form());
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('refuses to call the endpoint with neither a title nor a goal', () => {
    generate();

    expect(generateAgenda).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
  });

  it('sends an over-budget title rather than refusing it, since the server truncates', () => {
    const title = 'y'.repeat(MEETING_AGENDA_PROMPT_MAX_LENGTH + 50);
    formService.form().get('title')?.setValue(title);

    generate();

    expect(generateAgenda).toHaveBeenCalledWith(expect.objectContaining({ title }));
  });

  it('sends an over-budget goal rather than refusing it', () => {
    const context = 'x'.repeat(MEETING_AGENDA_PROMPT_MAX_LENGTH + 50);
    formService.form().get('aiPrompt')?.setValue(context);

    generate();

    expect(generateAgenda).toHaveBeenCalledWith(expect.objectContaining({ context }));
  });

  it('keeps the form valid with an over-budget aiPrompt, so Save stays live', () => {
    formService.form().get('title')?.setValue('TAC Monthly');
    formService
      .form()
      .get('aiPrompt')
      ?.setValue('x'.repeat(MEETING_AGENDA_PROMPT_MAX_LENGTH * 5));

    expect(formService.form().get('aiPrompt')?.errors).toBeNull();
    expect(formService.form().get('aiPrompt')?.valid).toBe(true);
  });
});

/**
 * Covers what an applied template or a generated agenda leaves behind on the controls it writes.
 *
 * `setValue` alone leaves a control pristine, and two surfaces read pristine as "still an untouched
 * default": the quick dialog's type-change prefill skips only dirty controls, and edit mode's Save is
 * dirty-gated. So a template the organizer deliberately picked was free for the next type switch to
 * overwrite, and a generated agenda in edit mode couldn't be saved.
 */
describe('ComposerAgendaFieldComponent — writes count as edits', () => {
  let fixture: ComponentFixture<ComposerAgendaFieldComponent>;
  let component: ComposerAgendaFieldComponent;
  let formService: MeetingComposerFormService;

  const popoverStub = { hide: vi.fn() } as unknown as Popover;
  // A duration off the form's 60-minute default, so `applyEstimatedDuration` actually writes rather
  // than short-circuiting on the no-op guard.
  const template: MeetingTemplate = {
    id: 'template-1',
    title: 'Weekly sync',
    content: '1. Roll call',
    meetingType: MeetingType.BOARD,
    estimatedDuration: 30,
  };
  const controlOf = (name: string): AbstractControl | null => formService.form().get(name);

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: { generateAgenda: vi.fn(() => of({ agenda: 'Roll call', estimatedDuration: 45 })) } },
        { provide: ProjectContextService, useValue: { activeContext: () => null, activeContextUid: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => null } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(ComposerAgendaFieldComponent, { set: { template: '', imports: [] } });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerAgendaFieldComponent);
    fixture.componentRef.setInput('form', formService.form());
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('marks the agenda dirty when a template is applied', () => {
    component['onApplyTemplate'](template, popoverStub);

    expect(controlOf('description')?.value).toBe(template.content);
    expect(controlOf('description')?.dirty).toBe(true);
  });

  it('marks the duration controls dirty when a template estimate is applied', () => {
    component['onApplyTemplate'](template, popoverStub);

    expect(controlOf('duration')?.value).toBe(30);
    expect(controlOf('duration')?.dirty).toBe(true);
    expect(controlOf('customDuration')?.dirty).toBe(true);
  });

  it('marks the agenda and duration dirty when the AI helper returns a draft', () => {
    formService.form().get('title')?.setValue('Quarterly review');

    component['onGenerateAgenda'](popoverStub);

    expect(controlOf('description')?.value).toBe('Roll call');
    expect(controlOf('description')?.dirty).toBe(true);
    expect(controlOf('duration')?.dirty).toBe(true);
  });

  // The estimate is dropped with a warning when it falls outside the custom-duration range, and a
  // dropped write must not claim the organizer touched the field — that would deaden the quick
  // dialog's prefill for a duration nobody set.
  it('leaves the duration pristine when the estimate is out of range and gets dropped', () => {
    component['onApplyTemplate']({ ...template, estimatedDuration: 100000 }, popoverStub);

    expect(controlOf('duration')?.dirty).toBe(false);
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AbstractControl } from '@angular/forms';
import { DEFAULT_DURATION, MAX_CUSTOM_DURATION, MEETING_AGENDA_PROMPT_MAX_LENGTH, MIN_CUSTOM_DURATION } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import type { GenerateAgendaResponse, MeetingTemplate } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Popover } from 'primeng/popover';
import { type Observable, of, Subject, throwError } from 'rxjs';
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

/**
 * The two popover affordances and the estimate arithmetic behind them. Both popovers are opened from
 * the field's own header rather than the section, so nothing else in the composer can put them right
 * when they misbehave: a templates popover opened with no meeting type has nothing to list, and a
 * prompt left behind after a close reappears pre-filled the next time the helper is opened.
 */
describe('ComposerAgendaFieldComponent — popovers and the estimated duration', () => {
  let fixture: ComponentFixture<ComposerAgendaFieldComponent>;
  let component: ComposerAgendaFieldComponent;
  let formService: MeetingComposerFormService;
  let messageAdd: ReturnType<typeof vi.fn>;
  let popover: { toggle: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn> };

  const template: MeetingTemplate = {
    id: 'template-1',
    title: 'Weekly sync',
    content: '1. Roll call',
    meetingType: MeetingType.BOARD,
    estimatedDuration: 30,
  };
  const applyEstimate = (estimatedDuration: number): void => component['onApplyTemplate']({ ...template, estimatedDuration }, popover as unknown as Popover);
  const toastsOfSeverity = (severity: string): unknown[] => messageAdd.mock.calls.filter(([message]) => message.severity === severity);

  beforeEach(async () => {
    messageAdd = vi.fn();
    popover = { toggle: vi.fn(), hide: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: messageAdd } },
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

  describe('onToggleTemplates', () => {
    it('says why instead of opening an empty popover when no meeting type is chosen', () => {
      component['onToggleTemplates'](new MouseEvent('click'), popover as unknown as Popover);

      expect(popover.toggle).not.toHaveBeenCalled();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Pick a meeting type' }));
    });

    it('opens the popover once a meeting type is chosen', () => {
      const event = new MouseEvent('click');
      formService.form().get('meeting_type')?.setValue(MeetingType.BOARD);

      component['onToggleTemplates'](event, popover as unknown as Popover);

      // The event is forwarded, not swallowed — PrimeNG anchors the overlay off its target.
      expect(popover.toggle).toHaveBeenCalledWith(event);
      expect(messageAdd).not.toHaveBeenCalled();
    });
  });

  describe('onAiHelperHide', () => {
    it('clears the prompt so the next open starts empty', () => {
      formService.form().get('aiPrompt')?.setValue('Focus on the release checklist');

      component['onAiHelperHide']();

      expect(formService.form().get('aiPrompt')?.value).toBe('');
    });

    it('runs on any close, including one the component did not initiate', () => {
      component['showAiHelper'].set(true);

      component['onAiHelperHide']();

      expect(component['showAiHelper']()).toBe(false);
    });
  });

  describe('applyEstimatedDuration', () => {
    it('writes a whole-minute estimate and says the duration moved', () => {
      applyEstimate(30);

      expect(formService.effectiveDuration()).toBe(30);
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', summary: 'Duration updated' }));
    });

    it('rounds a fractional estimate rather than handing the controls a fraction', () => {
      // Only the AI path produces these, but both callers share this helper.
      applyEstimate(30.4);

      expect(formService.effectiveDuration()).toBe(30);
    });

    it('routes an off-scale estimate through the custom control', () => {
      applyEstimate(125);

      expect(formService.form().get('duration')?.value).toBe('custom');
      expect(formService.effectiveDuration()).toBe(125);
    });

    it('stays silent when the estimate already matches the current duration', () => {
      // 60 is the form's own default, so this is the common case for a template built around it.
      applyEstimate(DEFAULT_DURATION);

      expect(formService.effectiveDuration()).toBe(DEFAULT_DURATION);
      expect(messageAdd).not.toHaveBeenCalled();
      expect(formService.form().get('duration')?.dirty).toBe(false);
    });

    it.each([
      ['below', MIN_CUSTOM_DURATION - 1],
      ['above', MAX_CUSTOM_DURATION + 1],
    ] as const)('drops an estimate %s the allowed range and leaves the duration alone', (_label, estimate) => {
      applyEstimate(estimate);

      expect(formService.effectiveDuration()).toBe(DEFAULT_DURATION);
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Duration left unchanged' }));
      expect(toastsOfSeverity('info')).toHaveLength(0);
    });

    it('still applies the agenda when the estimate is dropped', () => {
      // The two writes are independent: a duration the organizer has to set themselves is no reason
      // to withhold the agenda they asked for.
      applyEstimate(MAX_CUSTOM_DURATION + 1);

      expect(formService.form().get('description')?.value).toBe(template.content);
    });

    it('closes the templates popover whichever way the estimate lands', () => {
      applyEstimate(MAX_CUSTOM_DURATION + 1);

      expect(popover.hide).toHaveBeenCalled();
    });
  });
});

/**
 * The two ways a generation ends without landing a draft: one the server refuses, and one that answers
 * after the composer has moved on. Neither has a control of its own reporting it — the section is
 * destroyed on every rail change and the whole host on every successful save, so an in-flight request
 * routinely outlives the form it was asked for. A late write would land on whatever form is mounted by
 * then: the next section the organizer opened, or the blank one behind the next create.
 */
describe('ComposerAgendaFieldComponent \u2014 a generation that never lands', () => {
  let fixture: ComponentFixture<ComposerAgendaFieldComponent>;
  let component: ComposerAgendaFieldComponent;
  let formService: MeetingComposerFormService;
  let messageAdd: ReturnType<typeof vi.fn>;
  let response: Observable<GenerateAgendaResponse>;

  const popover = { hide: vi.fn() };
  const generate = (): void => component['onGenerateAgenda'](popover as unknown as Popover);
  const toastsOfSeverity = (severity: string): unknown[] => messageAdd.mock.calls.filter(([message]) => message.severity === severity);

  beforeEach(async () => {
    messageAdd = vi.fn();
    popover.hide = vi.fn();
    response = of({ agenda: 'Roll call', estimatedDuration: 30 });

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: { generateAgenda: vi.fn(() => response) } },
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
    formService.form().get('title')?.setValue('Quarterly review');
    await fixture.whenStable();
  });

  describe('when the request fails', () => {
    beforeEach(() => {
      // `MeetingService.generateAgenda` logs and re-throws, so the component sees a plain error.
      response = throwError(() => new Error('upstream refused'));
    });

    it('says the generation failed', () => {
      generate();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Generation failed' }));
      expect(toastsOfSeverity('success')).toHaveLength(0);
    });

    it('leaves the agenda alone rather than writing an empty draft over it', () => {
      formService.form().get('description')?.setValue('1. Roll call');

      generate();

      expect(formService.form().get('description')?.value).toBe('1. Roll call');
    });

    it('keeps the helper open so the goal the organizer typed is still there to retry with', () => {
      generate();

      expect(popover.hide).not.toHaveBeenCalled();
    });

    it('puts the Generate button back, so a failure is not a dead end', () => {
      generate();

      // `finalize` rather than the success handler, which a failure never reaches.
      expect(component['isGeneratingAgenda']()).toBe(false);
    });

    it('swallows the error instead of tearing the subscription down as unhandled', () => {
      expect(() => generate()).not.toThrow();
    });
  });

  describe('when the answer arrives after the section is gone', () => {
    let late: Subject<GenerateAgendaResponse>;

    beforeEach(() => {
      late = new Subject<GenerateAgendaResponse>();
      response = late;
    });

    it('drops the draft rather than writing it into a form the organizer has moved on from', () => {
      generate();
      const description = formService.form().get('description');
      fixture.destroy();

      late.next({ agenda: 'Roll call', estimatedDuration: 30 });

      expect(description?.value).toBe('');
      expect(description?.dirty).toBe(false);
      expect(toastsOfSeverity('success')).toHaveLength(0);
    });

    it('drops a late duration too, so the next meeting does not inherit this estimate', () => {
      generate();
      fixture.destroy();

      late.next({ agenda: 'Roll call', estimatedDuration: 30 });

      expect(formService.effectiveDuration()).toBe(DEFAULT_DURATION);
    });

    it('unsubscribes, so nothing is left listening for a response that may never come', () => {
      generate();
      expect(late.observed).toBe(true);

      fixture.destroy();

      expect(late.observed).toBe(false);
    });
  });
});

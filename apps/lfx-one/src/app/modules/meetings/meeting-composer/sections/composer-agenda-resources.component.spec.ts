// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MEETING_AGENDA_PROMPT_MAX_LENGTH, MEETING_AGENDA_PROMPT_WARNING_LENGTH } from '@lfx-one/shared/constants';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { ComposerAgendaResourcesComponent } from './composer-agenda-resources.component';

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
describe('ComposerAgendaResourcesComponent — AI helper guard', () => {
  let fixture: ComponentFixture<ComposerAgendaResourcesComponent>;
  let component: ComposerAgendaResourcesComponent;
  let formService: MeetingComposerFormService;
  let generateAgenda: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  const generate = (): void => component['onGenerateAgenda']();

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
    TestBed.overrideComponent(ComposerAgendaResourcesComponent, { set: { template: '', imports: [] } });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerAgendaResourcesComponent);
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

  it('counts the prompt characters for the cap indicator', () => {
    formService.form().get('aiPrompt')?.setValue('Plan the Q3 release');

    expect(component['aiPromptLength']()).toBe('Plan the Q3 release'.length);
  });

  it('escalates the prompt counter colour toward the cap', () => {
    const prompt = formService.form().get('aiPrompt');

    prompt?.setValue('x'.repeat(10));
    expect(component['aiPromptCounterClass']()).toBe('text-gray-500');

    prompt?.setValue('x'.repeat(MEETING_AGENDA_PROMPT_WARNING_LENGTH));
    expect(component['aiPromptCounterClass']()).toBe('text-amber-600');

    prompt?.setValue('x'.repeat(MEETING_AGENDA_PROMPT_MAX_LENGTH));
    expect(component['aiPromptCounterClass']()).toBe('text-red-600');
  });
});

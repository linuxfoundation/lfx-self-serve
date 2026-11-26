// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Dialog } from '@angular/cdk/dialog';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingType } from '@lfx-one/shared/enums';
import type { MeetingTemplate } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../../meeting-composer-form.service';
import { ComposerAgendaFieldRedesignComponent } from './composer-agenda-field-redesign.component';
import { ComposerAgendaResourcesRedesignComponent } from './composer-agenda-resources-redesign.component';

/** The agenda field without its template, for the computed-signal and form-write tests. */
@Component({ selector: 'lfx-state-only-agenda-field', template: '' })
class StateOnlyAgendaFieldComponent extends ComposerAgendaFieldRedesignComponent {}

describe('ComposerAgendaResourcesRedesignComponent', () => {
  let fixture: ComponentFixture<ComposerAgendaResourcesRedesignComponent>;
  let formService: MeetingComposerFormService;
  let generateAgenda: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn>;

  function query(testId: string): HTMLElement | null {
    return document.querySelector(`[data-testid="${testId}"]`);
  }

  function field(): ComposerAgendaFieldRedesignComponent {
    const stateFixture = TestBed.createComponent(StateOnlyAgendaFieldComponent);
    stateFixture.componentRef.setInput('form', formService.form());
    stateFixture.detectChanges();
    return stateFixture.componentInstance;
  }

  beforeEach(async () => {
    generateAgenda = vi.fn().mockReturnValue(of({ agenda: 'Generated agenda', estimatedDuration: 45 }));
    toast = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: toast } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: { generateAgenda } },
        { provide: SearchService, useValue: { searchUsers: () => of([]) } },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null, activeContext: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => null } },
      ],
    });
    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create' });
    fixture = TestBed.createComponent(ComposerAgendaResourcesRedesignComponent);
    fixture.componentRef.setInput('form', formService.form());
    await fixture.whenStable();
    fixture.detectChanges();
  });

  describe('agenda', () => {
    it('counts characters against the 2000 limit', () => {
      formService.form().get('description')?.setValue('Intro');
      fixture.detectChanges();

      expect(query('composer-agenda-counter')?.textContent?.trim()).toBe('5/2000');
    });

    it('offers the Other templates until a type is picked, then the type catalogue', () => {
      const agendaField = field();
      expect(agendaField['templateType']()).toBe(MeetingType.OTHER);

      formService.form().get('meeting_type')?.setValue(MeetingType.TECHNICAL);
      expect(agendaField['templateType']()).toBe(MeetingType.TECHNICAL);
    });

    it('replaces the agenda and the duration with a picked template, then closes the popover', () => {
      const close = vi.fn();
      field()['applyTemplate']({ content: 'Template agenda', estimatedDuration: 30 } as MeetingTemplate, close);

      expect(formService.form().get('description')?.value).toBe('Template agenda');
      expect(formService.effectiveDuration()).toBe(30);
      expect(close).toHaveBeenCalled();
    });

    it('generates an agenda from the goal or the title, then clears the prompt and closes', () => {
      const close = vi.fn();
      const agendaField = field();
      expect(agendaField['canGenerate']()).toBe(false);

      formService.form().get('title')?.setValue('Release sync');
      expect(agendaField['canGenerate']()).toBe(true);

      agendaField['aiPrompt'].set('Agree on the release date');
      agendaField['generate'](close);

      expect(generateAgenda).toHaveBeenCalledWith(expect.objectContaining({ context: 'Agree on the release date' }));
      expect(formService.form().get('description')?.value).toBe('Generated agenda');
      expect(agendaField['aiPrompt']()).toBe('');
      expect(formService.form().get('aiPrompt')?.value).toBe('');
      expect(close).toHaveBeenCalled();
    });
  });

  describe('resources', () => {
    it('queues a dropped file and rejects one over the size limit', () => {
      const ok = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
      const huge = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
      Object.defineProperty(huge, 'size', { value: 200 * 1024 * 1024 });
      const drop = new Event('drop') as DragEvent;
      Object.defineProperty(drop, 'dataTransfer', { value: { files: [ok, huge] } });

      query('composer-agenda-dropzone')!.dispatchEvent(drop);
      fixture.detectChanges();

      expect(query('composer-agenda-files')?.textContent).toContain('notes.pdf');
      expect(query('composer-agenda-files')?.textContent).not.toContain('huge.pdf');
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ summary: 'File not added' }));
    });

    it('adds a link through the Add link modal, requiring an https URL', async () => {
      (query('composer-agenda-add-link')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(query('composer-add-link-modal')).not.toBeNull();

      const component = fixture.componentInstance;
      component['linkForm'].setValue({ title: 'Notes', url: 'http://example.org' });
      expect(component['linkValid']()).toBe(false);

      component['linkForm'].setValue({ title: 'Notes', url: 'https://example.org/notes' });
      expect(component['linkValid']()).toBe(true);
      fixture.detectChanges();
      (query('composer-link-submit')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(TestBed.inject(Dialog).openDialogs).toHaveLength(0);
      expect(query('composer-agenda-links')?.textContent).toContain('https://example.org/notes');
    });

    it('queues picked files and removes a pending one', () => {
      const input = query('composer-agenda-file-input') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [new File(['x'], 'plan.pdf', { type: 'application/pdf' })], configurable: true });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      const pending = formService.form().get('attachments')?.value as { id: string }[];
      expect(pending).toHaveLength(1);

      (query(`composer-agenda-remove-attachment-${pending[0].id}`)!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(formService.form().get('attachments')?.value).toHaveLength(0);
    });

    it('queues a saved file for deletion and undoes it', () => {
      formService.attachments.set([{ uid: 'att-1', type: 'file', name: 'brief.pdf', file_size: 10 } as never]);
      fixture.detectChanges();

      (query('composer-agenda-delete-att-1')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(formService.pendingAttachmentDeletions()).toEqual(['att-1']);

      (query('composer-agenda-undo-delete-att-1')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(formService.pendingAttachmentDeletions()).toEqual([]);
    });

    it('removes a link row', () => {
      fixture.componentInstance['linkForm'].setValue({ title: 'Notes', url: 'https://example.org/notes' });
      fixture.componentInstance['submitLink']({ close: vi.fn() } as never);
      fixture.detectChanges();
      expect(query('composer-agenda-links')).not.toBeNull();

      (query('composer-agenda-remove-link-0')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(query('composer-agenda-links')).toBeNull();
    });

    it('keeps the drop highlight while the pointer moves onto the zone itself', () => {
      const zone = query('composer-agenda-dropzone')!;
      zone.dispatchEvent(new Event('dragover', { cancelable: true }));
      const inner = new Event('dragleave') as DragEvent;
      Object.defineProperty(inner, 'relatedTarget', { value: zone.querySelector('i') });
      zone.dispatchEvent(inner);
      expect(fixture.componentInstance['dragOver']()).toBe(true);

      const outer = new Event('dragleave') as DragEvent;
      Object.defineProperty(outer, 'relatedTarget', { value: document.body });
      zone.dispatchEvent(outer);
      expect(fixture.componentInstance['dragOver']()).toBe(false);
    });

    it('closes an open Add link modal when the section goes away', async () => {
      (query('composer-agenda-add-link')!.querySelector('button') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(TestBed.inject(Dialog).openDialogs).toHaveLength(1);

      fixture.destroy();
      expect(TestBed.inject(Dialog).openDialogs).toHaveLength(0);
    });

    it('hides documents and links in an occurrence edit', () => {
      fixture.componentRef.setInput('showResources', false);
      fixture.detectChanges();

      expect(query('composer-agenda-dropzone')).toBeNull();
      expect(query('composer-agenda-add-link')).toBeNull();
      expect(query('composer-agenda-field')).not.toBeNull();
    });
  });
});

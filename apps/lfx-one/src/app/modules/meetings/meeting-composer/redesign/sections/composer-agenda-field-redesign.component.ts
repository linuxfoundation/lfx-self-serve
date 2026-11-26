// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, signal, type Signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MeetingType } from '@lfx-one/shared/enums';
import type { MeetingTemplate } from '@lfx-one/shared/interfaces';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';
import { controlValueSignal } from '@shared/utils/form-control-signals.util';
import type { Popover } from 'primeng/popover';

import { AgendaTemplateSelectorComponent } from '../../../components/agenda-template-selector/agenda-template-selector.component';
import { ComposerAgendaFieldComponent } from '../../composer-agenda-field.component';

/**
 * Agenda field of the redesigned composer.
 * @description Extends the drawer's agenda field so template application, its duration side effect and AI generation stay shared;
 * the template moves to uikit popovers, and templates fall back to the Other catalogue until a type is picked.
 */
@Component({
  selector: 'lfx-composer-agenda-field-redesign',
  imports: [NgClass, ReactiveFormsModule, UiButtonComponent, UiTextareaComponent, AgendaTemplateSelectorComponent],
  templateUrl: './composer-agenda-field-redesign.component.html',
})
export class ComposerAgendaFieldRedesignComponent extends ComposerAgendaFieldComponent {
  protected readonly templateType: Signal<MeetingType> = computed(() => this.meetingType() ?? MeetingType.OTHER);
  /** The goal lives here, not in the form, so a dismissed popover cannot leave a hidden value or validator behind. */
  protected readonly aiPrompt = signal('');
  private readonly title = controlValueSignal<string>(this.form, 'title');
  /** The server drafts from a goal or, failing that, the title. */
  protected readonly canGenerate: Signal<boolean> = computed(() => !!(this.aiPrompt().trim() || this.title()?.trim()) && !this.isGeneratingAgenda());

  protected applyTemplate(template: MeetingTemplate, close: () => void): void {
    this.onApplyTemplate(template, this.popoverHandle(close));
  }

  protected generate(close: () => void): void {
    const prompt = this.form().get('aiPrompt');
    prompt?.setValue(this.aiPrompt());
    this.onGenerateAgenda(
      this.popoverHandle(() => {
        close();
        this.aiPrompt.set('');
      })
    );
    prompt?.setValue('');
  }

  // shortcut: adapts a uikit popover close to the base class's PrimeNG Popover parameter. revisit: when the drawer field is removed at flag cleanup.
  private popoverHandle(close: () => void): Popover {
    return { hide: close } as unknown as Popover;
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, effect, ElementRef, inject, input, PLATFORM_ID, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { ItOsAgentMessage, ItOsChange, ItOsChangePlan, ItOsChatField, ItOsChatForm } from '@lfx-one/shared/interfaces';

import { ItOsChatEngine } from '../services/it-os-chat-engine';

// Chat for the IT OS GitHub, email forwarding and mailing list agents (#4257): messages, inline forms,
// proposed changes to confirm, next-step buttons and suggestion chips. The agent's engine holds the state.
@Component({
  selector: 'lfx-it-os-agent-chat',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, TagComponent],
  templateUrl: './it-os-agent-chat.component.html',
})
export class ItOsAgentChatComponent {
  // === Injections ===
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly engine = input.required<ItOsChatEngine>();
  /** Font Awesome icon class for the agent's avatar. */
  public readonly icon = input.required<string>();
  public readonly iconClass = input.required<string>();
  public readonly testId = input.required<string>();

  // === Forms ===
  public readonly chatForm = new FormGroup({ message: new FormControl('', { nonNullable: true }) });

  private readonly conversation = viewChild<ElementRef<HTMLElement>>('conversation');

  public constructor() {
    // Keep the newest message in view.
    effect(() => {
      this.engine().messages();
      const el = this.conversation()?.nativeElement;
      if (el && isPlatformBrowser(this.platformId)) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }

  public send(): void {
    const text = this.chatForm.controls.message.value;
    if (!text.trim() || this.engine().busy()) return;
    this.chatForm.reset();
    this.engine().send(text);
  }

  /** Only the newest message's controls are live; earlier ones are history. */
  protected isActive(index: number, message: ItOsAgentMessage): boolean {
    return index === this.engine().messages().length - 1 && !message.used;
  }

  protected planCounts(plan: ItOsChangePlan): { on: number; approval: number } {
    const on = plan.changes.filter((c) => c.on);
    return { on: on.length, approval: on.filter((c) => this.engine().needsApproval(c)).length };
  }

  protected planConfirmLabel(plan: ItOsChangePlan): string {
    const { on, approval } = this.planCounts(plan);
    if (on && approval === on) return 'Submit for approval';
    if (approval) return `Apply ${on - approval}, submit ${approval}`;
    return `Apply ${on === 1 ? '1 change' : `${on} changes`}`;
  }

  protected toggle(change: ItOsChange, event: Event): void {
    this.engine().toggleChange(change, (event.target as HTMLInputElement).checked);
  }

  protected setText(form: ItOsChatForm, field: ItOsChatField, event: Event): void {
    this.engine().setField(form, field.id, (event.target as HTMLInputElement | HTMLTextAreaElement).value);
  }

  protected setChecked(form: ItOsChatForm, field: ItOsChatField, event: Event): void {
    this.engine().setField(form, field.id, (event.target as HTMLInputElement).checked);
  }

  protected fillSample(form: ItOsChatForm, field: ItOsChatField): void {
    this.engine().setField(form, field.id, field.sample ?? '');
  }

  protected textValue(form: ItOsChatForm, field: ItOsChatField): string {
    const value = form.values[field.id];
    return typeof value === 'string' ? value : '';
  }
}

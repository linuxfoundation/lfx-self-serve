// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, input, PLATFORM_ID, Signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { ItOsChange, ItOsChangePlan, ItOsChatField, ItOsChatForm, ItOsPlanView } from '@lfx-one/shared/interfaces';

import { ItOsChatEngine } from '../services/it-os-chat-engine';
import { planView, scrollKeyOf } from '../services/it-os-dns-html';

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

  // === Computed ===
  /** What each plan in the conversation shows, recomputed when the messages change. */
  protected readonly planViews: Signal<Map<ItOsChangePlan, ItOsPlanView>> = computed(() => {
    const engine = this.engine();
    return new Map(
      engine
        .messages()
        .filter((m) => m.plan)
        .map((m) => {
          const plan = m.plan as ItOsChangePlan;
          return [
            plan,
            planView(plan.changes, (c) => ({
              title: engine.describe(c),
              details: engine.details(c.payload),
              needsApproval: engine.needsApproval(c),
              reason: engine.reason(c),
            })),
          ];
        })
    );
  });
  /** Changes only when a message is added or a progress step appears, not when a field is edited. */
  private readonly scrollKey = computed(() => scrollKeyOf(this.engine().messages()));

  private readonly conversation = viewChild<ElementRef<HTMLElement>>('conversation');

  public constructor() {
    // Keep the newest message in view, without jumping while the user edits a form further up.
    effect(() => {
      this.scrollKey();
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

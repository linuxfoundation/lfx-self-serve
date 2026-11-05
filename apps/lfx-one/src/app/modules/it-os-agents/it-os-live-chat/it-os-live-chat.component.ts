// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, input, PLATFORM_ID, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { ProjectContextService } from '@services/project-context.service';

import { ItOsLiveAgentService } from '../services/it-os-live-agent.service';

// Live chat with an IT OS agent on Guild (#4257). Dev only. The server checks write access and tells the
// agent which project it is working on; this component only sends the project uid.
@Component({
  selector: 'lfx-it-os-live-chat',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent],
  providers: [ItOsLiveAgentService],
  templateUrl: './it-os-live-chat.component.html',
})
export class ItOsLiveChatComponent {
  // === Injections ===
  protected readonly live = inject(ItOsLiveAgentService);
  private readonly projectContext = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  /** IT OS agent id, e.g. `domains`. */
  public readonly agentId = input.required<string>();
  public readonly icon = input.required<string>();
  public readonly iconClass = input.required<string>();
  public readonly testId = input.required<string>();
  public readonly suggestions = input<string[]>([]);

  // === Forms ===
  public readonly chatForm = new FormGroup({ message: new FormControl('', { nonNullable: true }) });

  // === Computed ===
  protected readonly projectUid = this.projectContext.activeContextUid;
  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name ?? '');
  protected readonly canWrite = this.projectContext.canWrite;
  private readonly scrollKey = computed(() => `${this.live.messages().length}:${this.live.waiting()}`);

  private readonly conversation = viewChild<ElementRef<HTMLElement>>('conversation');

  public constructor() {
    // Keep the newest message in view.
    effect(() => {
      this.scrollKey();
      const el = this.conversation()?.nativeElement;
      if (el && isPlatformBrowser(this.platformId)) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }

  public send(text = this.chatForm.controls.message.value): void {
    if (!text.trim() || this.live.waiting() || !this.projectUid()) return;
    this.chatForm.reset();
    this.live.send(this.agentId(), this.projectUid(), text);
  }
}

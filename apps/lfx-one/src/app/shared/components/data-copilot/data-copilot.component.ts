// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { LensResponseComponent } from '@app/shared/components/lens-response/lens-response.component';
import { AccountContextService } from '@app/shared/services/account-context.service';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { LensService } from '@app/shared/services/lens.service';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { LENS_SUGGESTED_PROMPTS } from '@lfx-one/shared/constants';
import { LensContext } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';
import { map } from 'rxjs';

import type { Signal } from '@angular/core';

@Component({
  selector: 'lfx-data-copilot',
  imports: [DrawerModule, ButtonComponent, ReactiveFormsModule, LensResponseComponent],
  templateUrl: './data-copilot.component.html',
  styleUrl: './data-copilot.component.scss',
})
export class DataCopilotComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly lensService = inject(LensService);
  private readonly destroyRef = inject(DestroyRef);

  // Optional inputs to control which context fields are included
  public readonly includeOrganizationId = input<boolean>(true);
  public readonly includeOrganizationName = input<boolean>(true);
  public readonly includeProjectSlug = input<boolean>(true);
  public readonly includeProjectName = input<boolean>(true);

  // Form control
  public readonly messageControl = new FormControl('');

  // Drawer visibility
  public readonly visible = signal<boolean>(false);

  // Feature flag
  protected readonly isLfxLensEnabled = this.featureFlagService.getBooleanFlag('lfx-lens', false);

  // Lens service signals
  protected readonly messages = this.lensService.messages;
  protected readonly streaming = this.lensService.streaming;
  protected readonly currentStatus = this.lensService.currentStatus;
  protected readonly error = this.lensService.error;

  // Computed
  protected readonly hasMessages = computed(() => this.messages().length > 0);
  protected readonly canSend: Signal<boolean> = this.initCanSend();

  // Suggested prompts for empty state
  protected readonly suggestedPrompts = LENS_SUGGESTED_PROMPTS;

  // Auto-scroll
  private readonly messagesContainer = viewChild<ElementRef<HTMLDivElement>>('messagesContainer');
  private readonly chatTextarea = viewChild<ElementRef<HTMLTextAreaElement>>('chatTextarea');
  private autoScroll = true;
  private needsJsAutoGrow = false;

  // Context
  private readonly organizationId = computed(() => this.accountContextService.selectedAccount()?.accountId ?? '');
  private readonly organizationName = computed(() => this.accountContextService.selectedAccount()?.accountName ?? '');
  private readonly projectContext = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  private readonly projectSlug = computed(() => this.projectContext()?.slug ?? '');
  private readonly projectName = computed(() => this.projectContext()?.name ?? '');

  public constructor() {
    this.initAutoScroll();
    // Detect if field-sizing: content is unsupported (Firefox, older Safari)
    if (typeof CSS !== 'undefined' && !CSS.supports('field-sizing', 'content')) {
      this.needsJsAutoGrow = true;
    }
  }

  protected openDrawer(): void {
    this.visible.set(true);
  }

  protected onShow(): void {
    const el = this.chatTextarea()?.nativeElement;
    if (el) {
      setTimeout(() => el.focus(), 100);
    }
  }

  protected onHide(): void {
    this.visible.set(false);
    this.lensService.reset();
  }

  protected send(): void {
    const message = this.messageControl.value?.trim();
    if (!message || this.streaming()) return;

    this.lensService.sendMessage(message, this.buildContext());
    this.messageControl.setValue('');
    this.resetTextareaHeight();
    this.autoScroll = true;
  }

  protected sendPrompt(prompt: string): void {
    if (this.streaming()) return;
    this.lensService.sendMessage(prompt, this.buildContext());
    this.autoScroll = true;
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  protected onMessagesScroll(): void {
    this.autoScroll = this.isNearBottom();
  }

  protected abort(): void {
    this.lensService.abort();
  }

  protected autoGrowTextarea(): void {
    if (!this.needsJsAutoGrow) return;
    const el = this.chatTextarea()?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  private resetTextareaHeight(): void {
    if (!this.needsJsAutoGrow) return;
    const el = this.chatTextarea()?.nativeElement;
    if (el) {
      el.style.height = 'auto';
    }
  }

  private buildContext(): LensContext | undefined {
    const ctx: LensContext = {};

    if (this.includeOrganizationId() && this.organizationId()) {
      ctx.company = {
        id: this.organizationId(),
        ...(this.includeOrganizationName() ? { name: this.organizationName() } : {}),
      };
    }

    if (this.includeProjectSlug() && this.projectSlug()) {
      ctx.project = {
        slug: this.projectSlug(),
        ...(this.includeProjectName() ? { name: this.projectName() } : {}),
      };
    }

    return Object.keys(ctx).length > 0 ? ctx : undefined;
  }

  private initCanSend(): Signal<boolean> {
    return toSignal(this.messageControl.valueChanges.pipe(map((v) => !!v?.trim())), { initialValue: false });
  }

  private initAutoScroll(): void {
    toObservable(this.messages)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.autoScroll && typeof window !== 'undefined') {
          setTimeout(() => this.scrollToBottom(), 0);
        }
      });
  }

  private isNearBottom(): boolean {
    const el = this.messagesContainer()?.nativeElement;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }

  private scrollToBottom(): void {
    const el = this.messagesContainer()?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { CopilotResponseComponent } from '@app/shared/components/copilot-response/copilot-response.component';
import { AccountContextService } from '@app/shared/services/account-context.service';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { CopilotService } from '@app/shared/services/copilot.service';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { COPILOT_COMPANY_PROMPTS, COPILOT_FOUNDATION_PROMPTS } from '@lfx-one/shared/constants';
import { CopilotContext } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';
import { map } from 'rxjs';

import type { Signal } from '@angular/core';

@Component({
  selector: 'lfx-data-copilot',
  imports: [DrawerModule, ButtonComponent, ReactiveFormsModule, CopilotResponseComponent],
  templateUrl: './data-copilot.component.html',
  styleUrl: './data-copilot.component.scss',
})
export class DataCopilotComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly copilotService = inject(CopilotService);
  private readonly destroyRef = inject(DestroyRef);

  // Optional inputs to control which context fields are included
  public readonly includeOrganizationId = input<boolean>(true);
  public readonly includeOrganizationName = input<boolean>(true);
  public readonly includeFoundationSlug = input<boolean>(true);
  public readonly includeFoundationName = input<boolean>(true);

  // Form control
  public readonly messageControl = new FormControl('');

  // Drawer visibility
  public readonly visible = signal<boolean>(false);

  // Feature flag
  protected readonly isLfxLensEnabled = this.featureFlagService.getBooleanFlag('lfx-lens', false);

  // Copilot service signals
  protected readonly messages = this.copilotService.messages;
  protected readonly streaming = this.copilotService.streaming;
  protected readonly currentStatus = this.copilotService.currentStatus;
  protected readonly error = this.copilotService.error;
  protected readonly currentStage = this.copilotService.currentStage;
  protected readonly stageHistory = this.copilotService.stageHistory;

  // Computed
  protected readonly hasMessages = computed(() => this.messages().length > 0);
  protected readonly canSend: Signal<boolean> = this.initCanSend();

  // Context-aware display
  protected readonly contextLabel: Signal<string> = this.initContextLabel();
  protected readonly contextDescription: Signal<string> = this.initContextDescription();
  protected readonly suggestedPromptsForContext: Signal<readonly string[]> = this.initSuggestedPrompts();

  // Auto-scroll
  private readonly messagesContainer = viewChild<ElementRef<HTMLDivElement>>('messagesContainer');
  private readonly chatInput = viewChild<ElementRef<HTMLInputElement>>('chatInput');
  private autoScroll = true;

  // Context
  private readonly organizationId = computed(() => this.accountContextService.selectedAccount()?.accountId ?? '');
  private readonly organizationName = computed(() => this.accountContextService.selectedAccount()?.accountName ?? '');
  private readonly foundationContext = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  private readonly foundationSlug = computed(() => this.foundationContext()?.slug ?? '');
  private readonly foundationName = computed(() => this.foundationContext()?.name ?? '');
  private readonly hasCompanyContext = computed(() => this.includeOrganizationId() && !!this.organizationId());

  public constructor() {
    this.initAutoScroll();
  }

  protected openDrawer(): void {
    this.visible.set(true);
  }

  protected onShow(): void {
    const el = this.chatInput()?.nativeElement;
    if (el) {
      setTimeout(() => el.focus(), 100);
    }
  }

  protected onHide(): void {
    this.visible.set(false);
    this.copilotService.reset();
  }

  protected send(): void {
    const message = this.messageControl.value?.trim();
    if (!message || this.streaming()) return;

    const context = this.buildContext();
    if (!context) return;

    this.copilotService.sendMessage(message, context);
    this.messageControl.setValue('');
    this.autoScroll = true;
  }

  protected sendPrompt(prompt: string): void {
    if (this.streaming()) return;

    const context = this.buildContext();
    if (!context) return;

    this.copilotService.sendMessage(prompt, context);
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
    this.copilotService.abort();
  }

  protected newChat(): void {
    this.copilotService.reset();
  }

  private buildContext(): CopilotContext | undefined {
    const slug = this.includeFoundationSlug() ? this.foundationSlug() : '';
    const name = this.includeFoundationName() ? this.foundationName() : '';

    // Foundation is required by the API — cannot send context without it
    if (!slug || !name) {
      return undefined;
    }

    const ctx: CopilotContext = {
      foundation: { slug, name },
    };

    if (this.includeOrganizationId() && this.organizationId()) {
      ctx.company = {
        id: this.organizationId(),
        ...(this.includeOrganizationName() ? { name: this.organizationName() } : {}),
      };
    }

    return ctx;
  }

  private initCanSend(): Signal<boolean> {
    return toSignal(this.messageControl.valueChanges.pipe(map((v) => !!v?.trim())), { initialValue: false });
  }

  private initContextLabel(): Signal<string> {
    return computed(() => {
      const fName = this.foundationName();
      const cName = this.organizationName();
      if (this.hasCompanyContext() && cName && fName) {
        return `${cName} + ${fName}`;
      }
      if (fName) {
        return fName;
      }
      return 'your project';
    });
  }

  private initContextDescription(): Signal<string> {
    return computed(() => {
      const fName = this.foundationName();
      const cName = this.organizationName();
      if (this.hasCompanyContext() && cName && fName) {
        return `Explore memberships, contributions, events, and more for ${cName}'s involvement in ${fName}.`;
      }
      if (fName) {
        return `Explore memberships, contributions, events, and more for ${fName}.`;
      }
      return 'Explore your project data with natural language queries.';
    });
  }

  private initSuggestedPrompts(): Signal<readonly string[]> {
    return computed(() => (this.hasCompanyContext() ? COPILOT_COMPANY_PROMPTS : COPILOT_FOUNDATION_PROMPTS));
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

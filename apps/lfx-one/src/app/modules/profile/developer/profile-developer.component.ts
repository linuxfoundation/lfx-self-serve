// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { MessageComponent } from '@shared/components/message/message.component';
import { UserService } from '@shared/services/user.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { finalize } from 'rxjs';

@Component({
  selector: 'lfx-profile-developer',
  standalone: true,
  imports: [CommonModule, ButtonComponent, CardComponent, MessageComponent, ToastModule],
  providers: [],
  templateUrl: './profile-developer.component.html',
})
export class ProfileDeveloperComponent {
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly clipboard = inject(Clipboard);

  // Loading state
  public loading = signal<boolean>(true);

  // Token data using toSignal pattern
  public tokenInfo = this.initializeTokenInfo();

  // Loading state computed from tokenInfo
  public readonly isLoading = computed(() => this.loading());

  // API token computed from tokenInfo
  public readonly apiToken = computed(() => this.tokenInfo()?.token || '');

  // Token visibility toggle
  public maskToken = signal<boolean>(true);

  // Computed masked token
  public readonly maskedToken = computed(() => {
    const token = this.apiToken();
    if (!token) return '';
    if (token.length <= 8) return '*'.repeat(token.length);
    // Show first 4 chars + fixed number of asterisks + last 4 chars for better UX
    return token.substring(0, 4) + '••••••••••••' + token.substring(token.length - 4);
  });

  public toggleTokenVisibility(): void {
    this.maskToken.set(!this.maskToken());
  }

  public copyToken(): void {
    const token = this.apiToken();
    if (!token) {
      this.messageService.add({
        severity: 'warn',
        summary: 'No Token',
        detail: 'No API token available to copy.',
      });
      return;
    }

    const success = this.clipboard.copy(token);
    if (success) {
      this.messageService.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'API token copied to clipboard successfully.',
      });
    } else {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy Failed',
        detail: 'Failed to copy token to clipboard. Please try again.',
      });
    }
  }

  private initializeTokenInfo(): Signal<{ token: string; type: string } | null> {
    this.loading.set(true);
    return toSignal(this.userService.getDeveloperTokenInfo().pipe(finalize(() => this.loading.set(false))), { initialValue: null });
  }
}

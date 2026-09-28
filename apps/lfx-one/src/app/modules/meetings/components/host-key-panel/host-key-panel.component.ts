// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject, input, linkedSignal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';

import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';

@Component({
  selector: 'lfx-host-key-panel',
  imports: [ButtonComponent, TagComponent, TooltipModule],
  templateUrl: './host-key-panel.component.html',
})
export class HostKeyPanelComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);

  public readonly hostKey = input.required<string>();

  // Re-mask when a different meeting's key arrives on the same instance (same-instance navigation) —
  // the join page used to key reveal state on the meeting id; linkedSignal restores that guarantee here.
  public readonly revealed = linkedSignal(() => {
    this.hostKey();
    return false;
  });
  // aria-describedby needs a unique idref per instance (one panel per card popover) — CDK's generator
  // is APP_ID-scoped and SSR-safe, unlike a module-level counter.
  protected readonly helpId = inject(_IdGenerator).getId('host-key-help-');

  public toggleReveal(): void {
    this.revealed.update((current) => !current);
  }

  public copyHostKey(): void {
    const success = this.clipboard.copy(this.hostKey());
    if (success) {
      this.messageService.add({
        severity: 'success',
        summary: 'Host Key Copied',
        detail: 'The host key has been copied to your clipboard',
      });
    } else {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy Failed',
        detail: 'Unable to copy the host key. Please copy it manually.',
      });
    }
  }
}

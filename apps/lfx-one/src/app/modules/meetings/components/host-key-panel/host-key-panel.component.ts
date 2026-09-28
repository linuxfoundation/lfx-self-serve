// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject, input, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';

import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';

// aria-describedby needs a unique idref per instance: the panel renders once per card popover.
let helpIdCounter = 0;

@Component({
  selector: 'lfx-host-key-panel',
  imports: [ButtonComponent, TagComponent, TooltipModule],
  templateUrl: './host-key-panel.component.html',
})
export class HostKeyPanelComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);

  public readonly hostKey = input.required<string>();

  public readonly revealed = signal(false);
  protected readonly helpId = `host-key-help-${helpIdCounter++}`;

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

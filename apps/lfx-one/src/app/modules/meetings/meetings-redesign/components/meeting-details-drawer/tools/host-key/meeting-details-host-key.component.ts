// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, inject, input, linkedSignal } from '@angular/core';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';

/** Host controls in the meeting details drawer: the masked Zoom host key, its copy button and how to claim host. */
@Component({
  selector: 'lfx-meeting-details-host-key',
  imports: [UiButtonComponent],
  templateUrl: './meeting-details-host-key.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingDetailsHostKeyComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(UiToastService);

  public readonly hostKey = input.required<string>();

  /** Masked again whenever another key arrives. */
  protected readonly revealed = linkedSignal(() => {
    this.hostKey();
    return false;
  });
  protected readonly helpId = inject(_IdGenerator).getId('meeting-details-host-key-help-');

  protected toggle(): void {
    this.revealed.update((revealed) => !revealed);
  }

  protected copy(): void {
    if (this.clipboard.copy(this.hostKey())) {
      this.toast.show({ variant: 'dark', message: 'Meeting host key copied to clipboard' });
      return;
    }
    this.toast.show({
      variant: 'error',
      position: 'bottom-center',
      message: 'Copy Failed',
      description: 'Unable to copy the host key. Please copy it manually.',
    });
  }
}

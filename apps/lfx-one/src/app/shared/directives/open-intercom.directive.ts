// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, HostListener, inject, TransferState } from '@angular/core';
import { MessageService } from 'primeng/api';
import { getRuntimeConfig } from '@app/shared/providers/runtime-config.provider';
import { IntercomService } from '@services/intercom.service';

// Opens the Fin Intercom messenger on click, booting Intercom anonymously on demand when
// startup boot was skipped (impersonation, public pages, missing JWT claim). With no app id
// configured the click cannot open anything (boot() would refuse with only a console.warn),
// so surface that to the user instead of failing silently.
@Directive({
  selector: '[lfxOpenIntercom]',
})
export class OpenIntercomDirective {
  private readonly intercomService = inject(IntercomService);
  private readonly transferState = inject(TransferState);
  private readonly messageService = inject(MessageService);

  @HostListener('click', ['$event'])
  public onClick(event: MouseEvent): void {
    event.preventDefault();

    const { intercomAppId } = getRuntimeConfig(this.transferState);
    if (!intercomAppId) {
      this.messageService.add({
        severity: 'error',
        summary: 'Support Unavailable',
        detail: 'Support chat is unavailable right now. Please try again later.',
      });
      return;
    }

    this.intercomService.openMessenger(intercomAppId);
  }
}

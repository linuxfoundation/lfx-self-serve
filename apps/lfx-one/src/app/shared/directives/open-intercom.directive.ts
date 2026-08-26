// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, HostListener, inject, TransferState } from '@angular/core';
import { getRuntimeConfig } from '@app/shared/providers/runtime-config.provider';
import { IntercomService } from '@services/intercom.service';

// Opens the Fin Intercom messenger on click, booting Intercom anonymously on demand when
// startup boot was skipped (impersonation, public pages, missing JWT claim).
@Directive({
  selector: '[lfxOpenIntercom]',
})
export class OpenIntercomDirective {
  private readonly intercomService = inject(IntercomService);
  private readonly transferState = inject(TransferState);

  @HostListener('click', ['$event'])
  public onClick(event: MouseEvent): void {
    event.preventDefault();

    const { intercomAppId } = getRuntimeConfig(this.transferState);
    this.intercomService.openMessenger(intercomAppId);
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, HostListener, inject, TransferState } from '@angular/core';
import { MessageService } from 'primeng/api';
import { getRuntimeConfig } from '@app/shared/providers/runtime-config.provider';
import { identifiedIntercomBootOptions } from '@app/shared/utils/intercom-boot.util';
import { IntercomService } from '@services/intercom.service';
import { UserService } from '@services/user.service';

// Opens the Fin Intercom messenger on click, booting Intercom on demand when
// startup boot was skipped (impersonation, public pages, missing JWT claim, invite landing).
// Identified when UserService has a signed-in user with a JWT; otherwise anonymous.
// The click fails visibly (toast) rather than silently when no app id is configured
// (boot() would refuse with only a console.warn) or when the widget script fails to load
// after the click.
@Directive({
  selector: '[lfxOpenIntercom]',
})
export class OpenIntercomDirective {
  private readonly intercomService = inject(IntercomService);
  private readonly transferState = inject(TransferState);
  private readonly messageService = inject(MessageService);
  private readonly userService = inject(UserService);

  @HostListener('click', ['$event'])
  public onClick(event: MouseEvent): void {
    event.preventDefault();

    const { intercomAppId } = getRuntimeConfig(this.transferState);
    if (!intercomAppId) {
      this.showSupportUnavailableToast();
      return;
    }

    const user = this.userService.user();
    const identified = user ? identifiedIntercomBootOptions(user, intercomAppId) : null;
    const onLoadError = (): void => this.showSupportUnavailableToast();
    if (identified) {
      this.intercomService.openMessenger(intercomAppId, onLoadError, identified);
    } else {
      this.intercomService.openMessenger(intercomAppId, onLoadError);
    }
  }

  private showSupportUnavailableToast(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Support Unavailable',
      detail: 'Support chat is unavailable right now. Please try again later.',
    });
  }
}

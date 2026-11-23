// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, HostListener, inject, input, TransferState } from '@angular/core';
import { MessageService } from 'primeng/api';
import { getRuntimeConfig } from '@app/shared/providers/runtime-config.provider';
import { IntercomService } from '@services/intercom.service';

// Opens the Fin Intercom messenger on click, booting Intercom on demand when
// startup boot was skipped (impersonation, public pages, missing JWT claim, invite landing).
// The boot is identified when AppComponent staged an identity on IntercomService, anonymous
// otherwise — the identity decision stays there so this directive needs no user/session DI and
// can be used from any component, including ones rendered without HttpClient.
// The click fails visibly (toast) rather than silently when no app id is configured
// (boot() would refuse with only a console.warn) or when the widget script fails to load
// after the click.
// An optional `intercomMessage` pre-fills the composer of a new conversation with editable text;
// the same no-app-id and load-failure fallbacks apply.
@Directive({
  selector: '[lfxOpenIntercom]',
})
export class OpenIntercomDirective {
  public readonly intercomMessage = input<string>();

  private readonly intercomService = inject(IntercomService);
  private readonly transferState = inject(TransferState);
  private readonly messageService = inject(MessageService);

  @HostListener('click', ['$event'])
  public onClick(event: MouseEvent): void {
    event.preventDefault();
    this.open();
  }

  /** Opens the messenger; for a trigger that does not click, such as a keyboard-chosen menu item. */
  public open(): void {
    const { intercomAppId } = getRuntimeConfig(this.transferState);
    if (!intercomAppId) {
      this.showSupportUnavailableToast();
      return;
    }

    const onLoadError = (): void => this.showSupportUnavailableToast();
    const prefill = this.intercomMessage();
    // Plain support CTAs keep the two-argument call; only a pre-filled CTA passes the text.
    if (prefill) {
      this.intercomService.openMessenger(intercomAppId, onLoadError, prefill);
      return;
    }
    this.intercomService.openMessenger(intercomAppId, onLoadError);
  }

  private showSupportUnavailableToast(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Support Unavailable',
      detail: 'Support chat is unavailable right now. Please try again later.',
    });
  }
}

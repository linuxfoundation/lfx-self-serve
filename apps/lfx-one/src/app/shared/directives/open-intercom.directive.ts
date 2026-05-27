// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, HostListener, inject } from '@angular/core';
import { environment } from '@environments/environment';
import { IntercomService } from '@services/intercom.service';

// Falls back to the Jira support URL when Intercom is not booted.
@Directive({
  selector: '[lfxOpenIntercom]',
})
export class OpenIntercomDirective {
  private readonly intercomService = inject(IntercomService);

  @HostListener('click', ['$event'])
  public onClick(event: MouseEvent): void {
    event.preventDefault();

    if (this.intercomService.isBootRequested) {
      this.intercomService.show();
    } else if (typeof window !== 'undefined') {
      window.open(environment.urls.support, '_blank', 'noopener,noreferrer');
    }
  }
}

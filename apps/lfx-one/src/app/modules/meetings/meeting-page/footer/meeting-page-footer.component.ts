// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FOOTER_LEGAL_LINKS } from '@lfx-one/shared/constants';
import { TranscendService } from '@services/transcend.service';

/** Footer of the standalone meeting page: the LF logo, the copyright and legal links, and the cookie preferences. */
@Component({
  selector: 'lfx-meeting-page-footer',
  templateUrl: './meeting-page-footer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingPageFooterComponent {
  private readonly transcendService = inject(TranscendService);

  protected readonly links = FOOTER_LEGAL_LINKS;
  protected readonly year = new Date().getFullYear();
  /** False inside an iframe, where Transcend's consent manager cannot open. */
  protected readonly cookieSettingsAvailable = this.transcendService.preferencesAvailable;

  protected openCookieSettings(): void {
    this.transcendService.showPreferences();
  }
}

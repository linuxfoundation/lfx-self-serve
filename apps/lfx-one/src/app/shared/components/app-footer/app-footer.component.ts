// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FOOTER_LEGAL_LINKS } from '@lfx-one/shared/constants';
import { TranscendService } from '@services/transcend.service';

/**
 * Compact app footer: one copyright sentence with the LF legal links and an inline "Cookie settings"
 * action. Replaces the `<lfx-footer>` web component, whose shadow-DOM sentence cannot host the
 * cookie link and whose built-in padding made the footer tall.
 */
@Component({
  selector: 'lfx-app-footer',
  templateUrl: './app-footer.component.html',
})
export class AppFooterComponent {
  private readonly transcendService = inject(TranscendService);

  protected readonly links = FOOTER_LEGAL_LINKS;
  protected readonly year = new Date().getFullYear();

  /** Opens the Transcend consent manager. */
  protected openCookieSettings(): void {
    this.transcendService.showPreferences();
  }
}

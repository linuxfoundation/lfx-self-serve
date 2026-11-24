// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal, Signal } from '@angular/core';
import { CardComponent } from '@components/card/card.component';

import { CdpCompanySectionFrameComponent } from '../components/cdp-company-section-frame/cdp-company-section-frame.component';
import { CdpCompanySectionLoader } from '../cdp-company-section.loader';
import { formatCdpCompanyMonth } from '../cdp-company.util';

/**
 * CDP Company Profile: company-level facts only, read-only. It is not the B2B Profile
 * editor and offers no way into it.
 */
@Component({
  selector: 'lfx-cdp-company-profile',
  imports: [CdpCompanySectionFrameComponent, CardComponent],
  templateUrl: './cdp-company-profile.component.html',
})
export class CdpCompanyProfileComponent {
  protected readonly section = new CdpCompanySectionLoader('profile');

  /** A broken logo falls back to the placeholder tile. */
  protected readonly logoFailed = signal(false);
  protected readonly logoUrl: Signal<string | null> = computed(() => (this.logoFailed() ? null : (this.section.data()?.logoUrl ?? null)));
  protected readonly lastActive: Signal<string> = computed(() => formatCdpCompanyMonth(this.section.data()?.lastActiveMonth) ?? 'Unknown');
}

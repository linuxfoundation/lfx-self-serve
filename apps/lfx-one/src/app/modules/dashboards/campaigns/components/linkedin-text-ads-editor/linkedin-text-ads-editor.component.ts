// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, model } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { LINKEDIN_TEXT_AD_LIMITS } from '@lfx-one/shared/constants';
import type { LinkedInTextAdDraft, LinkedInTextAdView } from '@lfx-one/shared/interfaces';
import { linkedInTextAdViews, newLinkedInTextAdDraft } from '@lfx-one/shared/utils';
import { UiInputComponent } from '@shared/uikit/input/input.component';

/**
 * The LinkedIn Text Ads editor on the Implement tab (#5764 row 19): one headline and description per ad, with counters
 * and the error under each field. The parent owns the list, sends it, and holds Create; the rules live in
 * `campaign-linkedin-text-ads-form.utils.ts`.
 */
@Component({
  selector: 'lfx-linkedin-text-ads-editor',
  imports: [ButtonComponent, UiInputComponent],
  templateUrl: './linkedin-text-ads-editor.component.html',
})
export class LinkedInTextAdsEditorComponent {
  public readonly textAds = model.required<LinkedInTextAdDraft[]>();

  protected readonly limits = LINKEDIN_TEXT_AD_LIMITS;
  protected readonly views = computed<LinkedInTextAdView[]>(() => linkedInTextAdViews(this.textAds()));

  protected onTextChange(key: string, field: 'headline' | 'description', value: string): void {
    this.textAds.update((ads) => ads.map((ad) => (ad.key === key ? { ...ad, [field]: value } : ad)));
  }

  protected add(): void {
    this.textAds.update((ads) => (ads.length >= LINKEDIN_TEXT_AD_LIMITS.ads ? ads : [...ads, newLinkedInTextAdDraft(ads)]));
  }

  protected remove(key: string): void {
    this.textAds.update((ads) => (ads.length <= 1 ? ads : ads.filter((ad) => ad.key !== key)));
  }
}

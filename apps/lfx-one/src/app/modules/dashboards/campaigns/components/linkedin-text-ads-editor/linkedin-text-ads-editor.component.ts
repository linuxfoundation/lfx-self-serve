// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CREATIVE_ASSET_MIME_TYPES, LINKEDIN_TEXT_AD_IMAGE_LIMITS, LINKEDIN_TEXT_AD_LIMITS } from '@lfx-one/shared/constants';
import type { LinkedInTextAdDraft, LinkedInTextAdImageInput, LinkedInTextAdView } from '@lfx-one/shared/interfaces';
import { linkedInTextAdViews, newLinkedInTextAdDraft } from '@lfx-one/shared/utils';
import { UiInputComponent } from '@shared/uikit/input/input.component';

/**
 * The LinkedIn Text Ads editor on the Implement tab (#5764 row 19): one headline and description per ad, with counters
 * and the error under each field, and an optional 100x100 image per ad. The parent owns the list, the one LinkedIn upload
 * (`image`), sends them, and holds Create; the rules live in `campaign-linkedin-text-ads-form.utils.ts`.
 */
@Component({
  selector: 'lfx-linkedin-text-ads-editor',
  imports: [ButtonComponent, UiInputComponent],
  templateUrl: './linkedin-text-ads-editor.component.html',
})
export class LinkedInTextAdsEditorComponent {
  public readonly textAds = model.required<LinkedInTextAdDraft[]>();
  /** The upload slot, brief and capability state each ad's image is shown against; `undefined` shows no image state. */
  public readonly image = input<LinkedInTextAdImageInput>();
  /** Whether the image picker is offered: an explicit yes from the LinkedIn upload capability. */
  public readonly imageUploadAvailable = input(false);
  /** A file was picked for the ad `key`; the parent checks and uploads it. */
  public readonly imageFileChange = output<{ key: string; event: Event }>();
  /** The ad `key`'s image, or its upload, is removed. */
  public readonly imageRemove = output<string>();
  /** The capability check behind a `failed` image notice is retried. */
  public readonly retryCapabilities = output<void>();

  protected readonly limits = LINKEDIN_TEXT_AD_LIMITS;
  protected readonly imageLimits = LINKEDIN_TEXT_AD_IMAGE_LIMITS;
  protected readonly imageAccept = CREATIVE_ASSET_MIME_TYPES.join(',');
  protected readonly views = computed<LinkedInTextAdView[]>(() => linkedInTextAdViews(this.textAds(), this.image()));

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

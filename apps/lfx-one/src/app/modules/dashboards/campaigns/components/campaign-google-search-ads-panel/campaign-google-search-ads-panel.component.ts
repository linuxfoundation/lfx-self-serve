// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  CAMPAIGN_CHAR_LIMITS,
  CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES,
  GOOGLE_ADS_MAX_SEARCH_AD_PATH_WIDTH,
  GOOGLE_ADS_MAX_SEARCH_ADS_PER_AD_GROUP,
  GOOGLE_ADS_MAX_SEARCH_DESCRIPTIONS,
  GOOGLE_ADS_MAX_SEARCH_HEADLINES,
} from '@lfx-one/shared/constants';
import type { CampaignNegativeKeywordMatchType, CampaignSearchAd } from '@lfx-one/shared/interfaces';
import { parseNegativeKeywordInput } from '@lfx-one/shared/utils';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';

/**
 * The Google Search campaign's networks, its ads beyond the first ad's copy, and its create-time
 * negative keywords, on the Implement tab (#4991).
 *
 * The first ad's headlines and descriptions stay in the tab's own copy sections; this panel adds the
 * Search partners opt-in, that ad's display paths, up to two more ads with their own copy and paths,
 * and the campaign-level negative keywords. Same contract as `campaign-google-exclusions-panel`: it
 * renders straight from the
 * values it is given and writes every edit back through them, and the tab owns them — the draft, the
 * reset for a new brief, the Search gate and the shared refusals (`googleSearchAdPathsRefusal`,
 * `googleAdditionalSearchAdsRefusal`, `googleCreateNegativeKeywordsRefusal`) the BFF refuses a create with.
 */
@Component({
  selector: 'lfx-campaign-google-search-ads-panel',
  imports: [ButtonComponent, UiCheckboxComponent, UiInputComponent, UiOptionComponent, UiSelectComponent, UiTextareaComponent],
  templateUrl: './campaign-google-search-ads-panel.component.html',
})
export class CampaignGoogleSearchAdsPanelComponent {
  public readonly pathsError = input<string | null>(null);
  public readonly adsError = input<string | null>(null);
  public readonly negativeKeywordsError = input<string | null>(null);

  public readonly path1 = model.required<string>();
  public readonly path2 = model.required<string>();
  public readonly additionalAds = model.required<CampaignSearchAd[]>();
  public readonly negativeKeywordsText = model.required<string>();
  public readonly negativeKeywordMatchType = model.required<CampaignNegativeKeywordMatchType>();
  public readonly searchPartners = model.required<boolean>();

  protected readonly maxPathWidth = GOOGLE_ADS_MAX_SEARCH_AD_PATH_WIDTH;
  protected readonly maxAds = GOOGLE_ADS_MAX_SEARCH_ADS_PER_AD_GROUP;
  protected readonly maxHeadlines = GOOGLE_ADS_MAX_SEARCH_HEADLINES;
  protected readonly maxDescriptions = GOOGLE_ADS_MAX_SEARCH_DESCRIPTIONS;
  protected readonly charLimits = CAMPAIGN_CHAR_LIMITS;
  protected readonly negativeRules = CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES['google-ads'];

  /** Whether another ad fits: the first ad plus this list, against Google's per-ad-group limit. */
  protected readonly canAddAd: Signal<boolean> = computed(() => this.additionalAds().length + 1 < this.maxAds);
  /** How many negative keywords the text holds once blank and refused lines are left out, for the count. */
  protected readonly negativeKeywordCount: Signal<number> = computed(
    () => parseNegativeKeywordInput(this.negativeKeywordsText(), this.negativeRules.maxTextLength).keywords.length
  );
  /** `aria-describedby` for each section: its hint, plus its error while there is one. */
  protected readonly pathsDescribedBy: Signal<string> = computed(() =>
    this.pathsError() === null ? 'google-search-paths-hint' : 'google-search-paths-hint google-search-paths-error'
  );
  protected readonly adsDescribedBy: Signal<string> = computed(() =>
    this.adsError() === null ? 'google-search-ads-hint' : 'google-search-ads-hint google-search-ads-error'
  );
  protected readonly negativesDescribedBy: Signal<string> = computed(() =>
    this.negativeKeywordsError() === null ? 'google-search-negatives-hint' : 'google-search-negatives-hint google-search-negatives-error'
  );

  protected addAd(): void {
    if (!this.canAddAd()) return;
    this.additionalAds.update((ads) => [...ads, { headlines: [''], descriptions: [''], path1: '', path2: '' }]);
  }

  protected removeAd(index: number): void {
    this.additionalAds.update((ads) => ads.filter((_, i) => i !== index));
  }

  protected addLine(index: number, field: 'headlines' | 'descriptions'): void {
    const max = field === 'headlines' ? this.maxHeadlines : this.maxDescriptions;
    this.updateAd(index, (ad) => (ad[field].length >= max ? ad : { ...ad, [field]: [...ad[field], ''] }));
  }

  protected removeLine(index: number, field: 'headlines' | 'descriptions', line: number): void {
    this.updateAd(index, (ad) => ({ ...ad, [field]: ad[field].filter((_, i) => i !== line) }));
  }

  protected setLine(index: number, field: 'headlines' | 'descriptions', line: number, value: string): void {
    this.updateAd(index, (ad) => ({ ...ad, [field]: ad[field].map((text, i) => (i === line ? value : text)) }));
  }

  protected setAdPath(index: number, field: 'path1' | 'path2', value: string): void {
    this.updateAd(index, (ad) => ({ ...ad, [field]: value }));
  }

  protected onMatchType(value: string | null): void {
    const match = this.negativeRules.matchTypes.find((option) => option.value === value);
    if (match) this.negativeKeywordMatchType.set(match.value);
  }

  private updateAd(index: number, change: (ad: CampaignSearchAd) => CampaignSearchAd): void {
    this.additionalAds.update((ads) => ads.map((ad, i) => (i === index ? change(ad) : ad)));
  }
}

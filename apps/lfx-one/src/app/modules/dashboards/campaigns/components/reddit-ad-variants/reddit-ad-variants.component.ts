// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model } from '@angular/core';
import { MAX_REDDIT_AD_VARIANTS, MAX_REDDIT_HEADLINE_LENGTH } from '@lfx-one/shared/constants';
import type { RedditAdVariant, RedditAdVariantView } from '@lfx-one/shared/interfaces';
import { redditAdVariantsAdded, redditAdVariantsRemoved, redditAdVariantsWithHeadline, redditAdVariantViews } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';

/**
 * Editable Reddit ad variants on the Implement tab (#6108 row 6), seeded from the brief. The parent shows this only while
 * the deployment makes one ad per variant (`redditAdPerVariantEnabled`): then an authored post with 2 to 5 variants
 * becomes one Reddit ad per variant. Only the headline is edited; the brief's body stays as preview text, since
 * campaign-service never reads it. The parent owns the list, keeps it in the draft once edited, and holds Create.
 */
@Component({
  selector: 'lfx-reddit-ad-variants',
  imports: [UiButtonComponent, UiInputComponent],
  templateUrl: './reddit-ad-variants.component.html',
})
export class RedditAdVariantsComponent {
  public readonly variants = model.required<RedditAdVariant[]>();
  /** Whether each variant becomes its own ad: an authored post with 2 or more variants. */
  public readonly perVariant = input(false);

  protected readonly maxVariants = MAX_REDDIT_AD_VARIANTS;
  protected readonly maxHeadline = MAX_REDDIT_HEADLINE_LENGTH;
  protected readonly views = computed<RedditAdVariantView[]>(() => redditAdVariantViews(this.variants(), this.perVariant()));

  protected onHeadlineChange(index: number, headline: string): void {
    this.variants.update((variants) => redditAdVariantsWithHeadline(variants, index, headline));
  }

  protected add(): void {
    this.variants.update((variants) => redditAdVariantsAdded(variants));
  }

  protected remove(index: number): void {
    this.variants.update((variants) => redditAdVariantsRemoved(variants, index));
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DocsTopic } from '@lfx-one/shared/interfaces';

/**
 * Presentational topic tile for the docs landing grid.
 *
 * Consumed by `DocsLandingComponent` to render one card per top-level topic
 * (`docs/user/<topic>/`). Each tile links to the topic's landing article at
 * `/docs/<slug>` and surfaces the article count so visitors can gauge depth
 * before drilling in.
 *
 * Phase 3 (T026) ships the structural markup with Tailwind utility classes;
 * Phase 7 / US5 (T047) layers the brand-card surface tokens — at which point
 * this template adopts the existing `lfx-card` shared component, dropping
 * the inline class list.
 */
@Component({
  selector: 'lfx-docs-topic-card',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './docs-topic-card.component.html',
})
export class DocsTopicCardComponent {
  public readonly topic = input.required<DocsTopic>();

  protected readonly articleCountLabel = computed(() => {
    const n = this.topic().articleSlugs.length;
    return `${n} article${n === 1 ? '' : 's'}`;
  });

  protected readonly url = computed(() => `/docs/${this.topic().slug}`);
}

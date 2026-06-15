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

  // Per-topic tile visuals: a fa-light icon that fits the topic and the icon
  // container's color classes (background + icon text color). Colors group by
  // importance — Dashboard uses a gray-900 fill, the primary group bold blue,
  // and the secondary group bold violet, all with a white icon; the least
  // prominent group keeps a light-gray tint with a gray-900 icon. Class strings
  // are written in full so Tailwind's JIT detects them.
  private readonly topicVisuals: Record<string, { icon: string; container: string }> = {
    dashboards: { icon: 'fa-light fa-gauge-high', container: 'bg-gray-900 text-white' },
    meetings: { icon: 'fa-light fa-video', container: 'bg-blue-500 text-white' },
    events: { icon: 'fa-light fa-calendar-star', container: 'bg-blue-500 text-white' },
    committees: { icon: 'fa-light fa-user-group', container: 'bg-blue-500 text-white' },
    'mailing-lists': { icon: 'fa-light fa-envelope', container: 'bg-blue-500 text-white' },
    votes: { icon: 'fa-light fa-check-to-slot', container: 'bg-blue-500 text-white' },
    surveys: { icon: 'fa-light fa-square-poll-vertical', container: 'bg-blue-500 text-white' },
    documents: { icon: 'fa-light fa-file-lines', container: 'bg-blue-500 text-white' },
    trainings: { icon: 'fa-light fa-graduation-cap', container: 'bg-violet-600 text-white' },
    badges: { icon: 'fa-light fa-award', container: 'bg-violet-600 text-white' },
    profile: { icon: 'fa-light fa-id-badge', container: 'bg-gray-100 text-gray-900' },
    settings: { icon: 'fa-light fa-gear', container: 'bg-gray-100 text-gray-900' },
    transactions: { icon: 'fa-light fa-receipt', container: 'bg-gray-100 text-gray-900' },
  };

  protected readonly articleCountLabel = computed(() => {
    const n = this.topic().articleSlugs.length;
    return `${n} article${n === 1 ? '' : 's'}`;
  });

  protected readonly url = computed(() => `/docs/${this.topic().slug}`);

  protected readonly iconClass = computed(() => this.topicVisuals[this.topic().slug]?.icon ?? this.topic().icon ?? 'fa-light fa-file-lines');

  protected readonly containerClass = computed(() => this.topicVisuals[this.topic().slug]?.container ?? 'bg-blue-100 text-gray-900');
}

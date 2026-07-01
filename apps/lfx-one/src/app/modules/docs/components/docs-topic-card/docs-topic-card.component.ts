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

  // Per-topic tile visuals: a FontAwesome icon (name aligned with the app
  // navigation menu / lens entries) and the icon container's color classes
  // (background + icon text color). Colors group by importance — Dashboard uses
  // a gray-900 fill, the primary group bold blue, and the secondary group bold
  // violet, all with a white SOLID icon; the least prominent group keeps a
  // light-gray tint with a gray-900 LIGHT icon. Class strings are written in
  // full so Tailwind's JIT detects them.
  private readonly topicVisuals: Record<string, { icon: string; container: string }> = {
    dashboards: { icon: 'fa-solid fa-grid-2', container: 'bg-gray-900 text-white' },
    meetings: { icon: 'fa-solid fa-calendar', container: 'bg-blue-500 text-white' },
    events: { icon: 'fa-solid fa-ticket', container: 'bg-blue-500 text-white' },
    committees: { icon: 'fa-solid fa-users-rectangle', container: 'bg-blue-500 text-white' },
    'mailing-lists': { icon: 'fa-solid fa-envelope', container: 'bg-blue-500 text-white' },
    votes: { icon: 'fa-solid fa-check-to-slot', container: 'bg-blue-500 text-white' },
    surveys: { icon: 'fa-solid fa-clipboard-list', container: 'bg-blue-500 text-white' },
    documents: { icon: 'fa-solid fa-folder-open', container: 'bg-blue-500 text-white' },
    trainings: { icon: 'fa-solid fa-graduation-cap', container: 'bg-violet-600 text-white' },
    badges: { icon: 'fa-solid fa-award', container: 'bg-violet-600 text-white' },
    profile: { icon: 'fa-light fa-user', container: 'bg-gray-200 text-gray-900' },
    settings: { icon: 'fa-light fa-gear', container: 'bg-gray-200 text-gray-900' },
    transactions: { icon: 'fa-light fa-receipt', container: 'bg-gray-200 text-gray-900' },
    crowdfunding: { icon: 'fa-solid fa-box-dollar', container: 'bg-blue-500 text-white' },
  };

  protected readonly articleCountLabel = computed(() => {
    const n = this.topic().articleSlugs.length;
    return `${n} article${n === 1 ? '' : 's'}`;
  });

  protected readonly url = computed(() => `/docs/${this.topic().slug}`);

  protected readonly iconClass = computed(() => this.topicVisuals[this.topic().slug]?.icon ?? this.topic().icon ?? 'fa-light fa-file-lines');

  protected readonly containerClass = computed(() => this.topicVisuals[this.topic().slug]?.container ?? 'bg-blue-100 text-gray-900');
}

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

  // Per-topic tile visuals: a fa-light icon that fits the topic and a light
  // palette-color container background. Icons render in gray-900 (set on the
  // container). Class strings are written in full so Tailwind's JIT detects them.
  private readonly topicVisuals: Record<string, { icon: string; bg: string }> = {
    badges: { icon: 'fa-light fa-award', bg: 'bg-amber-100' },
    committees: { icon: 'fa-light fa-user-group', bg: 'bg-blue-100' },
    dashboards: { icon: 'fa-light fa-gauge-high', bg: 'bg-violet-100' },
    documents: { icon: 'fa-light fa-file-lines', bg: 'bg-blue-100' },
    events: { icon: 'fa-light fa-calendar-star', bg: 'bg-emerald-100' },
    'mailing-lists': { icon: 'fa-light fa-envelope', bg: 'bg-violet-100' },
    meetings: { icon: 'fa-light fa-video', bg: 'bg-amber-100' },
    profile: { icon: 'fa-light fa-id-badge', bg: 'bg-emerald-100' },
    settings: { icon: 'fa-light fa-gear', bg: 'bg-gray-100' },
    surveys: { icon: 'fa-light fa-square-poll-vertical', bg: 'bg-amber-100' },
    trainings: { icon: 'fa-light fa-graduation-cap', bg: 'bg-blue-100' },
    transactions: { icon: 'fa-light fa-receipt', bg: 'bg-emerald-100' },
    votes: { icon: 'fa-light fa-check-to-slot', bg: 'bg-violet-100' },
  };

  protected readonly articleCountLabel = computed(() => {
    const n = this.topic().articleSlugs.length;
    return `${n} article${n === 1 ? '' : 's'}`;
  });

  protected readonly url = computed(() => `/docs/${this.topic().slug}`);

  protected readonly iconClass = computed(() => this.topicVisuals[this.topic().slug]?.icon ?? this.topic().icon ?? 'fa-light fa-file-lines');

  protected readonly containerBg = computed(() => this.topicVisuals[this.topic().slug]?.bg ?? 'bg-blue-100');
}

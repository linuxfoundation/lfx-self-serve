// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { FormationProgressRingSize } from '@lfx-one/shared/interfaces';
import { FORMATION_PROGRESS_RING_SIZE_CLASSES } from '@lfx-one/shared/constants';

/**
 * A small "N of M done" progress ring (#2818) — the sub-items glyph the item drawer's summary and
 * the checklist row's disclosure trigger share. Decorative: the `<svg>` is `aria-hidden` and the
 * text beside it carries the count, so a screen reader never hears the tally twice. Only `done`
 * counts toward the fill, matching the "N of M done" wording it sits next to. Pure markup, no
 * browser APIs, so SSR and the browser render the same DOM.
 */
@Component({
  selector: 'lfx-formation-progress-ring',
  // The host element is the flex item its consumers lay out — size it to the svg, with no inline baseline slack.
  host: { class: 'inline-flex shrink-0 leading-none' },
  imports: [NgClass],
  templateUrl: './formation-progress-ring.component.html',
  styleUrl: './formation-progress-ring.component.scss',
})
export class FormationProgressRingComponent {
  public readonly done = input.required<number>();
  public readonly total = input.required<number>();
  public readonly size = input<FormationProgressRingSize>('md');

  /** The done share of the 100-unit path, clamped and rounded to two decimals so the DOM attribute stays readable; 0 when there is nothing to count. */
  protected readonly percent = computed(() => {
    const total = this.total();
    if (total <= 0) return 0;
    const clamped = Math.min(100, Math.max(0, (this.done() / total) * 100));
    return Math.round(clamped * 100) / 100;
  });
  /** The fill arc's `stroke-dasharray`: a dash the length of the done share, then a gap the length of the whole path, so the arc never wraps. */
  protected readonly dashArray = computed(() => `${this.percent()} 100`);
  /** A round-capped zero-length dash still paints a dot, so the fill arc only renders once something is done. */
  protected readonly showFill = computed(() => this.percent() > 0);
  protected readonly sizeClass = computed(() => FORMATION_PROGRESS_RING_SIZE_CLASSES[this.size()]);
}

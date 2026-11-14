// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';

/**
 * The Audience tab's always-visible answer to "what will this email go to?", pinned to the bottom
 * of the viewport while the operator works through the steps above it.
 *
 * Presentational, and deliberately without an attach or compose button of its own: those carry
 * gates and warnings that live beside them in the review step, so the bar's action only takes the
 * operator there.
 */
@Component({
  selector: 'lfx-audience-summary-bar',
  templateUrl: './audience-summary-bar.component.html',
  // Sticky on the HOST: the host is only as tall as the bar, so a sticky inner element had nowhere
  // to move and the bar stayed at the end of the page instead of following the viewport.
  host: { class: 'sticky bottom-0 z-10 block' },
})
export class AudienceSummaryBarComponent {
  public readonly included = input.required<number>();
  /** null while the suppression rows are loading: shown as a dash, never as a count of 0. */
  public readonly excluded = input.required<number | null>();
  public readonly reachText = input.required<string>();
  /**
   * What the reach figure is -- a previewed union, an upper bound summed over every list, or a sum
   * over only the lists that reported a size -- so the label never calls a bound or a partial a sum.
   */
  public readonly reachLabel = input('Reach');
  public readonly attached = input(false);
  public readonly review = output<void>();
}

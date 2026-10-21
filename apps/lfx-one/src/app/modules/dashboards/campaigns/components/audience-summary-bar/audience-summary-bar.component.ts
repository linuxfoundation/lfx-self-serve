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
})
export class AudienceSummaryBarComponent {
  public readonly included = input.required<number>();
  public readonly excluded = input.required<number>();
  public readonly reachText = input.required<string>();
  /** True when the reach figure is the exact union from "Preview audience size", not a sum. */
  public readonly reachExact = input(false);
  public readonly attached = input(false);
  public readonly review = output<void>();
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiEmptyStateHeadingLevel } from '@lfx-one/shared/interfaces';

/**
 * What a view shows when there is nothing in it yet: an icon, a title and one sentence, with optional actions.
 * Project each action (an `lfx-ui-button`, or a plain link) with the `empty-state-action` attribute: at most one primary button plus one secondary or link.
 * Project your own illustration with `empty-state-media` instead of (or beside) `icon`. Any other projected content, such as a grid of starter cards, sits below the actions.
 *
 * ```html
 * <lfx-ui-empty-state icon="fa-light fa-chart-bar" heading="No metrics yet" description="Connect a GitHub organization to start tracking contributors.">
 *   <lfx-ui-button empty-state-action (click)="connect()">Connect GitHub</lfx-ui-button>
 * </lfx-ui-empty-state>
 * ```
 */
@Component({
  selector: 'lfx-ui-empty-state',
  templateUrl: './empty-state.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Exact px, not rem; 14px root. The library pads 40px by 24px, spaces children 12px apart, and edges the area with an inset 1px ring.
    class: 'flex flex-col items-center gap-[12px] rounded-ui-md px-[24px] py-[40px] text-center ring-1 ring-inset ring-ui-neutral-alpha-200',
    'data-testid': 'ui-empty-state',
  },
})
export class UiEmptyStateComponent {
  /** Short statement of the situation, such as "No meetings scheduled". */
  public readonly heading = input.required<string>();
  /** One sentence that says what will appear here or what to do next. Up to 400px wide. */
  public readonly description = input<string>('');
  /** Font Awesome class string for the 48px icon tile, e.g. `fa-light fa-calendar`. Leave empty for no tile. */
  public readonly icon = input<string>('');
  /** Heading level (`aria-level`) of the title, 1 to 6. Pick the level that fits the page outline. */
  public readonly headingLevel = input<UiEmptyStateHeadingLevel>(3);
}

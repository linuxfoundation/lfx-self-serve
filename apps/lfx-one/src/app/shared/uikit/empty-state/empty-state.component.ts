// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { UiEmptyStateSize, UiHeadingLevel } from '@lfx-one/shared/interfaces';

/**
 * What a view shows when there is nothing in it yet: an icon, a title and one sentence, with optional actions. It draws no surface of its own; to sit on one, put it inside a card.
 * Project each action (an `lfx-ui-button`, or a plain link) with the `empty-state-action` attribute: at most one primary button plus one secondary or link.
 * Project your own illustration with `empty-state-media` instead of (or beside) `icon`. Any other projected content, such as a grid of starter cards, sits below the actions.
 * `size="small"` fits cards, side panels and popovers.
 *
 * ```html
 * <lfx-ui-empty-state icon="fa-light fa-chart-bar" heading="No metrics yet" description="Connect a GitHub organization to start tracking contributors.">
 *   <lfx-ui-button empty-state-action size="large" (click)="connect()">Connect GitHub</lfx-ui-button>
 * </lfx-ui-empty-state>
 * ```
 */
@Component({
  selector: 'lfx-ui-empty-state',
  templateUrl: './empty-state.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    'data-testid': 'ui-empty-state',
  },
})
export class UiEmptyStateComponent {
  /** Short statement of the situation, such as "No meetings scheduled". */
  public readonly heading = input.required<string>();
  /** One sentence that says what will appear here or what to do next. Up to 600px wide, with balanced line breaks. */
  public readonly description = input<string>('');
  /** Font Awesome class string for the icon tile (48px, or 40px when small), e.g. `fa-light fa-calendar`. Leave empty for no tile. */
  public readonly icon = input<string>('');
  /** Heading level (`aria-level`) of the title, 1 to 6. Pick the level that fits the page outline. */
  public readonly headingLevel = input<UiHeadingLevel>(3);
  /** `default` for page and list empty states; `small` for cards, side panels, popovers and other tight spaces. */
  public readonly size = input<UiEmptyStateSize>('default');

  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly iconClasses: Signal<string> = this.initIconClasses();
  protected readonly headingClasses: Signal<string> = this.initHeadingClasses();
  protected readonly descriptionClasses: Signal<string> = this.initDescriptionClasses();
  protected readonly actionsClasses: Signal<string> = this.initActionsClasses();

  private initHostClasses(): Signal<string> {
    // Exact px, not rem; 14px root. Library padding and child gap per size, with no ring or border.
    return computed(() => {
      const space = this.size() === 'small' ? 'gap-[8px] px-[16px] py-[24px]' : 'gap-[12px] px-[24px] py-[40px]';
      return `flex flex-col items-center rounded-ui-md text-center ${space}`;
    });
  }

  private initIconClasses(): Signal<string> {
    // Exact px: a 48px tile with a 20px glyph, or 40px with 16px when small, 4px above the title.
    return computed(() => {
      const box = this.size() === 'small' ? 'h-[40px] w-[40px] text-[16px]' : 'h-[48px] w-[48px] text-[20px]';
      return `mb-[4px] grid place-items-center rounded-ui-md bg-ui-background-100 text-ui-neutral-900 shadow-small ${box}`;
    });
  }

  private initHeadingClasses(): Signal<string> {
    // Default: Roboto Slab Light 20/28 (the heading-24 role at 20/28, as on modal titles). Small: Inter 500 14/20.
    return computed(() => {
      const type = this.size() === 'small' ? 'copy-14 font-medium' : 'heading-24 text-[20px] leading-[28px]';
      return `${type} text-ui-neutral-900`;
    });
  }

  private initDescriptionClasses(): Signal<string> {
    // 600px: library max width, no width utility for it.
    return computed(() => `max-w-[600px] text-balance text-ui-neutral-500 ${this.size() === 'small' ? 'copy-13' : 'copy-14'}`);
  }

  private initActionsClasses(): Signal<string> {
    // Exact px: 8px above and 12px between actions, or 4px and 8px when small. Collapses when nothing is projected.
    return computed(() => `flex items-center empty:hidden ${this.size() === 'small' ? 'mt-[4px] gap-[8px]' : 'mt-[8px] gap-[12px]'}`);
  }
}

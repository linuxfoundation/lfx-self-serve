// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';

/**
 * Reveals the rest of a long list or block in place: a small button between two rules, "Show 12 More" then "Show Less".
 * The component only owns the button. The page owns the content: render the extra rows when `expanded` is true, give
 * their container the id passed as `controls`, and move focus to the first revealed row.
 */
@Component({
  selector: 'lfx-ui-show-more',
  templateUrl: './show-more.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex items-center gap-[16px]', // 16px: library spacing-4
    'data-testid': 'ui-show-more',
  },
})
export class UiShowMoreComponent {
  /** Number of hidden items, shown as "Show 12 More". Leave at 0 to show "Show More". */
  public readonly hiddenCount = input<number>(0);
  /** Id of the element that holds the revealed content; written to `aria-controls`. */
  public readonly controls = input.required<string>();
  /** Drops the rules on both sides and uses the borderless button. */
  public readonly noBorder = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Whether the hidden content is revealed. Two-way: `[(expanded)]`. */
  public readonly expanded = model<boolean>(false);

  protected readonly label: Signal<string> = this.initLabel();
  protected readonly buttonClasses: Signal<string> = this.initButtonClasses();
  protected readonly ruleClasses: Signal<string> = this.initRuleClasses();

  protected toggle(): void {
    this.expanded.set(!this.expanded());
  }

  private initLabel(): Signal<string> {
    return computed(() => {
      if (this.expanded()) return 'Show Less';
      return this.hiddenCount() > 0 ? `Show ${this.hiddenCount()} More` : 'Show More';
    });
  }

  private initButtonClasses(): Signal<string> {
    // shortcut: native button styled like the library's tertiary button. revisit: when lfx-ui-button realigns to the library, swap to it.
    // Exact px: 10px radius (a missing token), 10px padding and 6px gap are library steps with no ui-* utility.
    const base =
      'inline-flex h-ui-small cursor-pointer items-center justify-center gap-[6px] whitespace-nowrap rounded-[10px] px-[10px] button-14 text-ui-neutral-900 transition-colors duration-ui-base ease-ui-standard hover:bg-ui-neutral-alpha-100 active:bg-ui-neutral-alpha-200 focus-visible:shadow-focus focus-visible:outline-none motion-reduce:transition-none';
    return computed(() => (this.noBorder() ? `${base} bg-transparent` : `${base} bg-ui-background-100 shadow-border`));
  }

  private initRuleClasses(): Signal<string> {
    return computed(() => (this.noBorder() ? 'h-px flex-1 bg-transparent' : 'h-px flex-1 bg-ui-neutral-alpha-200'));
  }
}

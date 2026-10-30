// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { UiButtonVariant } from '@lfx-one/shared/interfaces';

import { UiButtonComponent } from '../button/button.component';

/**
 * Reveals the rest of a long list or block in place: a small button between two rules, "Show 12 More" then "Show Less".
 * The component only owns the button. The page owns the content: render the extra rows when `expanded` is true, give
 * their container the id passed as `controls`, and move focus to the first revealed row.
 */
@Component({
  selector: 'lfx-ui-show-more',
  imports: [UiButtonComponent],
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
  protected readonly variant: Signal<UiButtonVariant> = this.initVariant();
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

  // Library: a small secondary button; the borderless form drops to tertiary (as in the library preview).
  private initVariant(): Signal<UiButtonVariant> {
    return computed(() => (this.noBorder() ? 'tertiary' : 'secondary'));
  }

  private initButtonClasses(): Signal<string> {
    // The library's 12px chevron flips when expanded. Exact px, not rem; `button>i` outranks the button's own 16px icon rule.
    const base = '[&_button>i]:text-[12px] [&_button>i]:transition-transform [&_button>i]:duration-ui-base motion-reduce:[&_button>i]:transition-none';
    return computed(() => (this.expanded() ? `${base} [&_button>i]:rotate-180` : base));
  }

  private initRuleClasses(): Signal<string> {
    return computed(() => (this.noBorder() ? 'h-px flex-1 bg-transparent' : 'h-px flex-1 bg-ui-neutral-alpha-200'));
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { toSpokenKey } from '@lfx-one/shared/utils';

/**
 * Shows a key or shortcut that triggers an action, one `<kbd>` per key. Write modifiers as their symbols (⌘ ⇧ ⌥ ⌃) and show Ctrl on
 * Windows and Linux. Keep words such as "or" and punctuation outside the keys. In running prose, plain text such as "press ⌘K" copies better.
 */
@Component({
  selector: 'lfx-ui-keyboard-input',
  templateUrl: './keyboard-input.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Exact px, not rem: the app root font is 14px.
    class: 'inline-flex items-center gap-[4px]',
    'data-testid': 'ui-keyboard-input',
  },
})
export class UiKeyboardInputComponent {
  /** The keys in order, such as `['⌘', 'K']` or `['Esc']`. Pass a modifier chord rendered as one key as a single entry, such as `['⌘K']`. */
  public readonly keys = input.required<string[]>();
  /** `md` is 24px tall with 14px text; `sm` is 20px tall with 12px text, for menu rows, command bars and table cells. */
  public readonly size = input<'sm' | 'md'>('md');

  protected readonly keyClasses: Signal<string> = this.initKeyClasses();
  protected readonly spokenKeys: Signal<string[]> = this.initSpokenKeys();

  private initKeyClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem: the app root font is 14px. The type-role class sets the sans family, which `<kbd>` would not inherit.
      const base =
        'inline-flex items-center justify-center whitespace-nowrap rounded-ui-xs bg-ui-background-100 leading-none text-ui-neutral-600 tabular-nums edge';
      const sizes = {
        md: 'h-ui-tiny min-w-[24px] px-[6px] label-14',
        sm: 'h-[20px] min-w-[20px] px-[4px] label-12',
      };
      return `${base} ${sizes[this.size()]}`;
    });
  }

  private initSpokenKeys(): Signal<string[]> {
    return computed(() => {
      // Screen readers skip or misread glyphs, so each key with one gets a spoken name.
      return this.keys().map((key) => toSpokenKey(key));
    });
  }
}

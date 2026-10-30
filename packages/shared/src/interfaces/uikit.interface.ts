// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** A tab in the uikit underline tabs. */
export interface UiTabItem {
  /** Stable value written to the tabs' selected value when this tab is chosen. */
  value: string;
  /** Visible tab label. */
  label: string;
  /** Optional count shown after the label. */
  count?: number;
  /** Greys the tab out and removes it from keyboard navigation. */
  disabled?: boolean;
}

/** Colour role of a uikit badge and its status dot. `neutral` is the default. */
export type UiBadgeTone = 'neutral' | 'accent' | 'feature' | 'warning' | 'danger' | 'success';

/** Colour role that tints a uikit avatar. `neutral` is the quiet default. */
export type UiAvatarTone = 'neutral' | 'accent' | 'feature' | 'success' | 'warning' | 'danger';

/** A person, organization or bot shown in a uikit avatar group. */
export interface UiAvatarItem {
  /** The literal name. Becomes the avatar's accessible name and its initials. */
  name: string;
  /** Photo URL. When it is missing or fails to load, the initials show instead. */
  src?: string;
  /** Colour role that tints the initials circle, to tell people apart in dense lists. */
  tone?: UiAvatarTone;
}

/** Options for `UiModalService.open`. Every field is optional. */
export interface UiModalConfig<D = unknown> {
  /** Passed to the modal content, which reads it with the CDK `DIALOG_DATA` token. */
  data?: D;
  /** `alertdialog` for confirmations that need an answer, such as deleting something. Defaults to `dialog`. */
  role?: 'dialog' | 'alertdialog';
  /** Close when the user clicks the dimmed backdrop. Defaults to `true`. */
  closeOnBackdropClick?: boolean;
  /** Close when the user presses Escape. Defaults to `true`. */
  closeOnEscape?: boolean;
  /** Describe the dialog by its subtitle, so a screen reader reads the consequence when it opens. Set it only when the layout has a subtitle. */
  describedBy?: boolean;
  /** Element that gets focus on open: `first-tabbable` (default), `first-heading`, `dialog`, or a CSS selector such as `[data-autofocus]`. */
  autoFocus?: string;
}

/** Which side of its host a uikit tooltip prefers. */
export type UiTooltipSide = 'top' | 'right' | 'bottom' | 'left';

/** Size of a uikit toggle: `default` 28x16, `medium` 36x20 or `large` 44x24. */
export type UiToggleSize = 'default' | 'medium' | 'large';

/** Colour of a uikit toggle when on. `warning` and `danger` flag settings with consequences. */
export type UiToggleTone = 'accent' | 'warning' | 'danger';

/** Size of the uikit loading dots: 4, 5 or 7px dots. */
export type UiLoadingDotsSize = 'sm' | 'md' | 'lg';

/** Height of a uikit text input: `tiny` 24px, `small` 32px, `medium` 40px. Matches the button sizes. */
export type UiInputSize = 'tiny' | 'small' | 'medium';

/** Native `type` of a uikit text input. There is no `number`: it would hand forms a string. Use `text` with the input's `inputmode` instead. */
export type UiInputType = 'text' | 'email' | 'url' | 'tel' | 'password' | 'search';

/** Virtual keyboard hint of a uikit text input, the native `inputmode` values. */
export type UiInputMode = 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';

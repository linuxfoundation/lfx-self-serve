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
  /** Element that gets focus on open: `first-tabbable` (default), `first-heading`, `dialog`, or a CSS selector such as `[data-autofocus]`. */
  autoFocus?: string;
}

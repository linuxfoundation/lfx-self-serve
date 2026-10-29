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

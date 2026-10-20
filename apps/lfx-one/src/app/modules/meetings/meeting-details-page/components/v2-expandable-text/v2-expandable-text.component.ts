// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Component, inject } from '@angular/core';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';

/**
 * V2's own `lfx-expandable-text` (#3260): the shared component's measuring and height logic, inherited
 * unchanged, behind one persistent disclosure toggle.
 * @description The shared component swaps two buttons when it flips, which drops keyboard focus, and
 * reports no state. It stays as `main` has it, because V1 renders it, so V2's agenda and AI summary use
 * this variant instead: a single button that keeps focus, with `aria-expanded` and `aria-controls`.
 * The testids (`read-more-button` / `see-less-button`, `expandable-content`) match the shared ones.
 */
@Component({
  selector: 'lfx-meeting-v2-expandable-text',
  imports: [],
  templateUrl: './v2-expandable-text.component.html',
  // The shared fade-out styles, so the collapsed state looks the same as the shared component's.
  styleUrl: '../../../../../shared/components/expandable-text/expandable-text.component.scss',
})
export class MeetingV2ExpandableTextComponent extends ExpandableTextComponent {
  /** The content region's id, for the toggle's aria-controls; stable across SSR and hydration. */
  protected readonly contentId = inject(_IdGenerator).getId('lfx-meeting-v2-expandable-text-');
}

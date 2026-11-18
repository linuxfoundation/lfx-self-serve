// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

/** A group's visibility as a 20px icon with a tooltip: a green globe when public, a lock on a dark circle when private. */
@Component({
  selector: 'lfx-group-visibility',
  imports: [UiTooltipDirective],
  templateUrl: './group-visibility.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class GroupVisibilityComponent {
  public readonly isPublic = input.required<boolean>();
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { UiAvatarItem } from '@lfx-one/shared/interfaces';

import { UiAvatarComponent } from './avatar.component';

/** Overlapping avatars with a 2px ring of the page background. Shows up to `limit` of them, then a "+N" tile for the rest. */
@Component({
  selector: 'lfx-ui-avatar-group',
  imports: [UiAvatarComponent],
  templateUrl: './avatar-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex items-center',
    role: 'group',
    'data-testid': 'ui-avatar-group',
  },
})
export class UiAvatarGroupComponent {
  /** The people, organizations or bots to show, in order. */
  public readonly items = input.required<UiAvatarItem[]>();
  /** Size of every avatar in px. Each one overlaps the previous by 28% of this. */
  public readonly size = input<number>(32);
  /** How many avatars to show before collapsing the rest into a "+N" tile. Rounded down; values below 1 count as 1. */
  public readonly limit = input<number, number>(3, { transform: (value) => Math.max(1, Math.floor(value)) });

  protected readonly visible: Signal<UiAvatarItem[]> = this.initVisible();
  protected readonly overflow: Signal<number> = this.initOverflow();
  protected readonly overlap: Signal<number> = this.initOverlap();

  private initVisible(): Signal<UiAvatarItem[]> {
    return computed(() => this.items().slice(0, this.limit()));
  }

  private initOverflow(): Signal<number> {
    return computed(() => Math.max(0, this.items().length - this.limit()));
  }

  private initOverlap(): Signal<number> {
    return computed(() => this.size() * -0.28);
  }
}

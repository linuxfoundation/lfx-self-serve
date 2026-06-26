// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, signal, type Signal } from '@angular/core';
import { avatarColorClass, avatarInitials, splitDisplayName } from '@lfx-one/shared/utils';

type PersonAvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<PersonAvatarSize, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

// Canonical person avatar: photo → two-letter initials on a stable per-identity color → person icon for
// a blank name. A broken/404 image also falls back to initials so a row never breaks.
@Component({
  selector: 'lfx-person-avatar',
  imports: [],
  templateUrl: './person-avatar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonAvatarComponent {
  public readonly avatarUrl = input<string | null | undefined>(null);
  public readonly name = input<string | null | undefined>(null);
  /** Optional precomputed two-letter initials; derived from `name` when omitted. */
  public readonly initials = input<string | null | undefined>(null);
  /** Stable color seed (email preferred, then username); falls back to `name`. */
  public readonly identity = input<string | null | undefined>(null);
  public readonly size = input<PersonAvatarSize>('md');

  // Track the failed URL (not a boolean) so a reused @for instance doesn't suppress a later valid avatar.
  protected readonly failedAvatarUrl = signal<string | null>(null);

  protected readonly resolvedInitials: Signal<string> = this.initResolvedInitials();
  protected readonly badgeClass: Signal<string> = this.initBadgeClass();
  protected readonly sizeClass = computed<string>(() => SIZE_CLASSES[this.size()]);
  protected readonly containerClass = computed<string>(() => `${this.sizeClass()} ${this.badgeClass()}`);
  protected readonly displayImage: Signal<boolean> = this.initDisplayImage();

  protected onImageError(): void {
    this.failedAvatarUrl.set(this.avatarUrl() ?? null);
  }

  private initResolvedInitials(): Signal<string> {
    return computed(() => {
      const provided = (this.initials() ?? '').trim().toUpperCase();
      if (provided) {
        return provided.slice(0, 2);
      }
      const name = this.name() ?? null;
      const [first, last] = splitDisplayName(name);
      return avatarInitials(first, last, name);
    });
  }

  private initBadgeClass(): Signal<string> {
    return computed(() => {
      if (!this.resolvedInitials()) {
        return 'bg-gray-400';
      }
      return avatarColorClass(this.identity() ?? this.name());
    });
  }

  private initDisplayImage(): Signal<boolean> {
    return computed(() => {
      const url = this.avatarUrl();
      return !!url && this.failedAvatarUrl() !== url;
    });
  }
}

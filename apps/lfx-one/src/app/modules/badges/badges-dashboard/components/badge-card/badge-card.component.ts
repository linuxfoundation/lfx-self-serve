// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal, Signal } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { EnrichedBadge, ShareChannel } from '@lfx-one/shared/interfaces';
import { PlausibleService } from '@services/plausible.service';
import { MenuItem, MessageService } from 'primeng/api';

import { buildLinkedInAddToProfileUrl } from '../../../utils/linkedin-share.util';

@Component({
  selector: 'lfx-badge-card',
  imports: [CardComponent, DatePipe, MenuComponent],
  templateUrl: './badge-card.component.html',
  styleUrl: './badge-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BadgeCardComponent {
  // === Services ===
  private readonly messageService = inject(MessageService);
  private readonly plausible = inject(PlausibleService);

  // === Inputs ===
  public readonly badge = input.required<EnrichedBadge>();

  // === Writable Signals ===
  protected readonly menuOpen = signal<boolean>(false);

  // === Constants ===
  // navigator.share is undefined on most desktop browsers and during SSR; capture once for SSR-safety.
  protected readonly canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // === Computed Signals ===
  protected readonly shareMenuItems: Signal<MenuItem[]> = this.initShareMenuItems();

  // === Protected Methods ===
  protected shareToLinkedIn(): void {
    const b = this.badge();
    const url = buildLinkedInAddToProfileUrl(b);
    // Only track when the popup actually opens — window.open returns null when blocked.
    const opened = typeof window !== 'undefined' ? window.open(url, '_blank', 'noopener,noreferrer') : null;
    if (opened) {
      this.emitShared(b, 'linkedin');
    }
  }

  protected async nativeShare(): Promise<void> {
    const b = this.badge();
    if (!b.shareUrl || !this.canNativeShare) return;
    try {
      await navigator.share({
        title: b.title,
        text: `I earned the ${b.title} badge from ${b.issuer}.`,
        url: b.shareUrl,
      });
      this.emitShared(b, 'native_share');
    } catch (err) {
      // User-dismissed sheet — keep silent so we don't toast on a deliberate cancel.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      this.messageService.add({
        severity: 'error',
        summary: 'Share failed',
        detail: 'Unable to open share sheet',
        data: err,
      });
    }
  }

  protected async copyLink(): Promise<void> {
    const b = this.badge();
    if (!b.shareUrl) return;
    if (!navigator.clipboard?.writeText) {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy not supported',
        detail: 'Clipboard access is unavailable in this browser.',
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(b.shareUrl);
      this.messageService.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'Badge URL copied to clipboard',
      });
      this.emitShared(b, 'copy_link');
    } catch (err) {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy failed',
        detail: 'Unable to copy link to clipboard',
        data: err,
      });
    }
  }

  // === Private Initializers ===
  private initShareMenuItems(): Signal<MenuItem[]> {
    return computed(() => {
      const items: MenuItem[] = [
        {
          label: 'Add to LinkedIn',
          icon: 'fa-brands fa-linkedin',
          command: () => this.shareToLinkedIn(),
        },
      ];
      if (this.canNativeShare) {
        items.push({
          label: 'Share…',
          icon: 'fa-light fa-share-nodes',
          command: () => this.nativeShare(),
        });
      }
      items.push({
        label: 'Copy link',
        icon: 'fa-light fa-link',
        command: () => this.copyLink(),
      });
      return items;
    });
  }

  // === Private Helpers ===
  private emitShared(badge: EnrichedBadge, channel: ShareChannel): void {
    this.plausible.trackEvent('badge_shared', {
      badgeId: badge.id,
      badgeTitle: badge.title,
      issuer: badge.issuer,
      channel,
    });
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { HEALTH_SCORE_BAR_FILL, HEALTH_SCORE_CATEGORIES, HEALTH_SCORE_LABELS, ORG_HEALTH_POPUP_UNAVAILABLE_TEXT } from '@lfx-one/shared/constants';
import { getHealthScoreDescription, getMissingHealthCategoryName } from '@lfx-one/shared/utils';
import { PopoverModule } from 'primeng/popover';
import type { Popover } from 'primeng/popover';

import type { HealthScore, OrgLensHealthPopupRow } from '@lfx-one/shared/interfaces';

// Health popover for the Projects table and project-detail hero; hosts call show and scheduleHide.
@Component({
  selector: 'lfx-org-health-popup',
  imports: [PopoverModule],
  templateUrl: './org-health-popup.component.html',
  styleUrl: './org-health-popup.component.scss',
})
export class OrgHealthPopupComponent {
  public readonly score = input<number | null>(null);
  public readonly label = input<Exclude<HealthScore, 'unavailable'> | null>(null);
  public readonly maxScore = input<number | null>(null);
  public readonly maintainer = input<number | null>(null);
  public readonly security = input<number | null>(null);
  public readonly development = input<number | null>(null);

  protected readonly unavailableText = ORG_HEALTH_POPUP_UNAVAILABLE_TEXT;
  protected readonly available = computed(() => this.label() != null && this.score() != null);
  // Partial = the max is capped under 100, the same condition that draws the dotted remainder.
  protected readonly isPartial = computed(() => {
    const max = this.maxScore();
    return max != null && max < 100;
  });
  protected readonly labelText = computed(() => {
    const band = this.label();
    if (band == null) {
      return '';
    }
    return `${HEALTH_SCORE_LABELS[band]}${this.isPartial() ? '*' : ''}`;
  });
  protected readonly missingCategoryName = computed(() =>
    getMissingHealthCategoryName(this.maintainer() ?? null, this.security() ?? null, this.development() ?? null)
  );
  protected readonly scoreText = computed(() => `(${this.score() ?? 0}/${this.maxScore() ?? 100})`);
  // Raw score on a 0-100 track; the points no covered category can earn render as a dotted remainder.
  protected readonly barFillPercent = computed(() => Math.min(Math.max(this.score() ?? 0, 0), 100));
  protected readonly barMissingPercent = computed(() => {
    const max = this.maxScore();
    return max == null ? 0 : Math.min(Math.max(100 - max, 0), 100 - this.barFillPercent());
  });
  protected readonly barFillColor = computed(() => {
    const band = this.label();
    return band == null ? HEALTH_SCORE_BAR_FILL.healthy : HEALTH_SCORE_BAR_FILL[band];
  });
  protected readonly description = computed(() => getHealthScoreDescription(this.label(), this.maintainer(), this.security(), this.development()));
  protected readonly rows = computed<OrgLensHealthPopupRow[]>(() =>
    HEALTH_SCORE_CATEGORIES.map((c) => {
      const value = this[c.key]();
      return { key: c.key, name: c.name, icon: c.icon, score: value == null ? null : String(value), max: c.max };
    })
  );

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly popover = viewChild<Popover>('popover');
  private readonly content = viewChild<ElementRef<HTMLElement>>('popupContent');

  /** Open state for the badge's `aria-expanded`; driven by the popover's own show/hide events. */
  public readonly isOpen = signal(false);

  // `appendTo="body"` detaches the popover from the triggering badge, so the pointer briefly leaves
  // the badge while crossing to the popover — a same-tick `hide()` on the badge's `mouseleave` would
  // close it before the pointer arrives. Deferring the hide lets a `mouseenter` on the popover
  // itself cancel it first (same pattern as org-spend-bar's "others" popover).
  private hidePopoverTimeoutId: ReturnType<typeof setTimeout> | undefined;
  // Keyboard activation moves focus into the popup so screen readers read the breakdown; the badge
  // that opened it gets focus back on hide. Hover/focus opens never steal focus. Restoring focus
  // fires the badge's own `(focus)` → `show()`, which must not reopen what the user just closed.
  private focusOnShow = false;
  private returnFocusTo: HTMLElement | null = null;
  private suppressNextFocusShow = false;

  public constructor() {
    // Navigating away mid-hover would otherwise leave the pending hide holding a destroyed component.
    inject(DestroyRef).onDestroy(() => clearTimeout(this.hidePopoverTimeoutId));
  }

  public show(event: Event): void {
    if (event.type === 'focus' && this.suppressNextFocusShow) {
      this.suppressNextFocusShow = false;
      return;
    }
    this.cancelHide();
    this.popover()?.show(event);
  }

  /** Keyboard-activated open (Enter/Space on the badge): opens and moves focus into the popup. */
  public showAndFocus(event: Event): void {
    this.focusOnShow = true;
    this.returnFocusTo = this.isBrowser && event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.show(event);
    if (this.isOpen()) {
      this.focusContent();
    }
  }

  public scheduleHide(): void {
    this.cancelHide();
    this.hidePopoverTimeoutId = setTimeout(() => this.popover()?.hide(), 100);
  }

  public cancelHide(): void {
    clearTimeout(this.hidePopoverTimeoutId);
  }

  protected onShow(): void {
    this.isOpen.set(true);
    if (this.focusOnShow) {
      this.focusContent();
    }
  }

  protected onHide(): void {
    this.isOpen.set(false);
    this.focusOnShow = false;
    const badge = this.returnFocusTo;
    this.returnFocusTo = null;
    if (!this.isBrowser) {
      return;
    }
    // Restore focus only when the close left it nowhere useful (Escape / click-outside → body, or still inside the
    // popup). A Tab-away already moved focus on purpose; yanking it back would trap the user.
    const active = document.activeElement;
    const focusStranded = active === null || active === document.body || (this.content()?.nativeElement.contains(active) ?? false);
    if (badge && focusStranded) {
      this.suppressNextFocusShow = true;
      badge.focus();
      this.suppressNextFocusShow = false;
    }
  }

  private focusContent(): void {
    this.focusOnShow = false;
    this.content()?.nativeElement.focus();
  }
}

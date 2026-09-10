// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import {
  HEALTH_SCORE_BAR_FILL,
  HEALTH_SCORE_CATEGORIES,
  HEALTH_SCORE_LABELS,
  HEALTH_SCORE_PARTIAL_SUFFIX,
  ORG_HEALTH_POPUP_UNAVAILABLE_TEXT,
} from '@lfx-one/shared/constants';
import { getHealthScoreDescription, isPartialHealthScore } from '@lfx-one/shared/utils';
import { PopoverModule } from 'primeng/popover';
import type { Popover } from 'primeng/popover';

import type { HealthScore, OrgLensHealthPopupRow } from '@lfx-one/shared/interfaces';

/**
 * Shared Org Lens health popup — a PrimeNG popover bound to a health badge on the Projects
 * table and the project-detail hero. Content ports the Insights health-score pill 1:1 (headline,
 * rescaled bar, generated description, three `/40 /35 /25` rows); the header shell (title + outbound
 * `LFX Insights` link) is Org Lens. Hosts open it on badge hover/focus and schedule-hide on
 * leave/blur (see `scheduleHide`).
 */
@Component({
  selector: 'lfx-org-health-popup',
  imports: [PopoverModule],
  templateUrl: './org-health-popup.component.html',
})
export class OrgHealthPopupComponent {
  public readonly score = input<number | null>(null);
  public readonly label = input<Exclude<HealthScore, 'unavailable'> | null>(null);
  public readonly maxScore = input<number | null>(null);
  public readonly coveredCount = input<number | null>(null);
  public readonly maintainer = input<number | null>(null);
  public readonly security = input<number | null>(null);
  public readonly development = input<number | null>(null);
  /** Project's LFX Insights page URL — computed once by the host (BFF `lfxInsightsUrl` / table `insightsUrl`). */
  public readonly insightsUrl = input.required<string>();

  protected readonly unavailableText = ORG_HEALTH_POPUP_UNAVAILABLE_TEXT;
  protected readonly available = computed(() => this.label() != null && this.score() != null);
  protected readonly partial = computed(() => this.available() && isPartialHealthScore(this.coveredCount()));
  protected readonly headline = computed(() => {
    const band = this.label();
    const points = this.score();
    if (band == null || points == null) {
      return '';
    }
    return `${HEALTH_SCORE_LABELS[band]}${this.partial() ? HEALTH_SCORE_PARTIAL_SUFFIX : ''} (${points}/${this.maxScore() ?? 100})`;
  });
  protected readonly barFill = computed(() => {
    const points = this.score();
    if (points == null) {
      return 0;
    }
    return (points / (this.maxScore() ?? 100)) * 100;
  });
  protected readonly barFillColor = computed(() => {
    const band = this.label();
    return band == null ? HEALTH_SCORE_BAR_FILL.healthy : HEALTH_SCORE_BAR_FILL[band];
  });
  protected readonly description = computed(() => getHealthScoreDescription(this.label(), this.maintainer(), this.security(), this.development()));
  protected readonly rows = computed<OrgLensHealthPopupRow[]>(() =>
    HEALTH_SCORE_CATEGORIES.map((c) => ({ key: c.key, name: c.name, icon: c.icon, display: `${this[c.key]() ?? '-'}/${c.max}` }))
  );

  private readonly popover = viewChild<Popover>('popover');
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');

  /** Open state for the badge's `aria-expanded`; driven by the popover's own show/hide events. */
  public readonly isOpen = signal(false);

  // `appendTo="body"` detaches the popover from the triggering badge, so the pointer briefly leaves
  // the badge while crossing to the popover — a same-tick `hide()` on the badge's `mouseleave` would
  // close it before the pointer arrives. Deferring the hide lets a `mouseenter` on the popover
  // itself cancel it first (same pattern as org-spend-bar's "others" popover).
  private hidePopoverTimeoutId: ReturnType<typeof setTimeout> | undefined;
  // Keyboard activation moves focus into the popup so the Insights link is reachable; the badge
  // that opened it gets focus back on hide. Hover/focus opens never steal focus.
  private focusOnShow = false;
  private returnFocusTo: HTMLElement | null = null;

  public constructor() {
    // Navigating away mid-hover would otherwise leave the pending hide holding a destroyed component.
    inject(DestroyRef).onDestroy(() => clearTimeout(this.hidePopoverTimeoutId));
  }

  public show(event: Event): void {
    this.cancelHide();
    this.popover()?.show(event);
  }

  /** Keyboard-activated open (Enter/Space on the badge): opens and moves focus into the popup. */
  public showAndFocus(event: Event): void {
    this.focusOnShow = true;
    this.returnFocusTo = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
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
    this.returnFocusTo?.focus();
    this.returnFocusTo = null;
  }

  private focusContent(): void {
    this.focusOnShow = false;
    this.content()?.nativeElement.focus();
  }
}

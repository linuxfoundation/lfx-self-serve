// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, ElementRef, inject, input, output, signal } from '@angular/core';

import type { HealthMetricsL2SubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Section nav for a Health Metrics Level 2 tab (the design's `.hmn`), right of the sections. Purely
 * presentational — the shell owns scroll-spy and scrolling; this emits the picked section and renders the badges.
 */
@Component({
  selector: 'lfx-health-metrics-l2-sub-nav',
  imports: [NgClass],
  templateUrl: './health-metrics-l2-sub-nav.component.html',
  styleUrl: './health-metrics-l2-sub-nav.component.scss',
  // The host is the flex item, so it is what sticks; a sticky child would have no room to travel in it.
  host: {
    role: 'navigation',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.data-testid]': "testIdPrefix() + '-sub-nav'",
    '[class.hmn-closed]': 'closed()',
    '[style.top.px]': 'topPx()',
    '(mouseleave)': 'closed.set(false)',
    '(focusin)': 'closed.set(false)',
    '(click)': 'openFromRail($event)',
    '(keydown.escape)': 'dismiss()',
  },
})
export class HealthMetricsL2SubNavComponent {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  public readonly items = input.required<readonly HealthMetricsL2SubNavItem[]>();
  public readonly activeKey = input.required<string>();
  /** Sticky offset below the page header, so the nav pins just under it. */
  public readonly topPx = input.required<number>();
  public readonly ariaLabel = input.required<string>();
  /** Prefixes every `data-testid`, so each tab keeps its own test ids. */
  public readonly testIdPrefix = input.required<string>();

  public readonly sectionPicked = output<string>();

  /** Keeps the collapsed panel shut after a pick until the pointer leaves, as hover would reopen it at once. */
  protected readonly closed = signal(false);

  protected pick(key: string, event: Event): void {
    this.sectionPicked.emit(key);
    this.dismiss(event.currentTarget as HTMLElement);
  }

  /** A tap on the collapsed rail has no hover to open the panel, so it focuses the current item instead. */
  protected openFromRail(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('.hmn-rail')) return;
    this.closed.set(false);
    this.elementRef.nativeElement.querySelector<HTMLElement>('.hmn-item[aria-current]')?.focus();
  }

  /** Shuts the collapsed panel; the wide column has nothing to close, so it keeps the reader's focus. */
  protected dismiss(focused: HTMLElement | null = this.elementRef.nativeElement.querySelector<HTMLElement>('.hmn-item:focus')): void {
    if (!this.isCollapsed()) return;
    this.closed.set(true);
    focused?.blur();
  }

  /** The rail only shows while the page is narrow enough to collapse the nav. */
  private isCollapsed(): boolean {
    const rail = this.elementRef.nativeElement.querySelector<HTMLElement>('.hmn-rail');
    return !!rail && getComputedStyle(rail).display !== 'none';
  }
}

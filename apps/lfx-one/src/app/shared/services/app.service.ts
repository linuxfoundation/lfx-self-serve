// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';

/**
 * Application-wide state management service
 * Handles global application state like mobile sidebar visibility
 */
@Injectable({
  providedIn: 'root',
})
export class AppService {
  // Mobile sidebar state
  private readonly showMobileSidebarSignal = signal(false);

  public readonly showMobileSidebar = this.showMobileSidebarSignal.asReadonly();

  // Pages rendering the app footer themselves; the layout skips its own while any is alive
  private readonly footerOwners = signal(0);

  public readonly pageOwnsFooter = computed(() => this.footerOwners() > 0);

  /**
   * Toggle mobile sidebar visibility
   */
  public toggleMobileSidebar(): void {
    this.showMobileSidebarSignal.update((value) => !value);
  }

  /**
   * Close mobile sidebar
   */
  public closeMobileSidebar(): void {
    this.showMobileSidebarSignal.set(false);
  }

  /**
   * Open mobile sidebar
   */
  public openMobileSidebar(): void {
    this.showMobileSidebarSignal.set(true);
  }

  /**
   * Claim the app footer for a page that renders it itself; call the returned function to release it
   */
  public claimFooter(): () => void {
    this.footerOwners.update((count) => count + 1);
    return () => this.footerOwners.update((count) => Math.max(count - 1, 0));
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal } from '@angular/core';

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
}

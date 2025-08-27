// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, afterNextRender } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

/**
 * Network Information API types for enhanced browser compatibility
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Network_Information_API
 */
interface NetworkInformation extends EventTarget {
  readonly type?: 'bluetooth' | 'cellular' | 'ethernet' | 'none' | 'other' | 'unknown' | 'wifi' | 'wimax';
  readonly effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  readonly downlink?: number;
  readonly downlinkMax?: number;
  readonly rtt?: number;
  readonly saveData?: boolean;
}

interface NavigatorWithConnection extends Navigator {
  readonly connection?: NetworkInformation;
  readonly mozConnection?: NetworkInformation;
  readonly webkitConnection?: NetworkInformation;
}

@Injectable({
  providedIn: 'root',
})
export class CustomPreloadingStrategy implements PreloadingStrategy {
  private connectionInfo: { effectiveType: string | null; saveData: boolean } | null = null;

  public constructor() {
    // Initialize connection info safely after render using Angular's afterNextRender
    afterNextRender(() => {
      this.connectionInfo = this.getConnectionInfo();
    });
  }

  public preload(route: Route, load: () => Observable<any>): Observable<any> {
    if (route.data && route.data['preload']) {
      // Use cached connection info or safe defaults
      const connectionInfo = this.connectionInfo || { effectiveType: null, saveData: false };
      const isSlowConn = this.isSlowConnection(connectionInfo);

      if (isSlowConn) {
        // On slow connections or data saver mode, skip preloading
        return of(null);
      }

      // For fast/unknown connections, preload after configured delay
      const delay = route.data['preloadDelay'] || 2000; // Default 2 second delay
      return timer(delay).pipe(mergeMap(() => load()));
    }

    return of(null);
  }

  /**
   * Detects network connection information with cross-browser support
   * Note: Only called in browser environment via afterNextRender()
   * @returns Object with connection info or safe defaults if API not supported
   */
  private getConnectionInfo(): { effectiveType: string | null; saveData: boolean } {
    const nav = navigator as NavigatorWithConnection;

    // Try different vendor prefixes for broader browser support
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;

    if (!connection) {
      // Network Information API not supported (Safari, older browsers)
      return { effectiveType: null, saveData: false };
    }

    return {
      effectiveType: connection.effectiveType || null,
      saveData: connection.saveData || false,
    };
  }

  /**
   * Determines if the connection is considered slow based on available information
   * @param connectionInfo Connection information from getConnectionInfo()
   * @returns true if connection should be treated as slow
   */
  private isSlowConnection(connectionInfo: { effectiveType: string | null; saveData: boolean }): boolean {
    // If user has enabled data saver mode, treat as slow connection
    if (connectionInfo.saveData) {
      return true;
    }

    // If Network API is not supported, assume moderate connection (don't skip preloading)
    if (!connectionInfo.effectiveType) {
      return false;
    }

    // Check for explicitly slow connection types
    return connectionInfo.effectiveType === 'slow-2g' || connectionInfo.effectiveType === '2g';
  }
}

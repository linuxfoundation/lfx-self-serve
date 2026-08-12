// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { ORG_LENS_ROI_METHOD_STORAGE_KEY, ORG_LENS_ROI_METHODS } from '@lfx-one/shared/constants';
import type { OrgLensRoiMethod } from '@lfx-one/shared/interfaces';

/**
 * The viewer's chosen estimation method, persisted across visits.
 *
 * Shared by the ROI portfolio page, which offers the control, and the project detail view, which
 * only honours it — a drill-down that silently reverted to the default would show the viewer a
 * project priced on a different basis than the portfolio they arrived from, with nothing on screen
 * saying so.
 *
 * Callers must read this in `afterNextRender` rather than a constructor: the server has no stored
 * value, so restoring one during construction changes the first render and breaks hydration.
 */
@Injectable({ providedIn: 'root' })
export class OrgLensRoiMethodPreferenceService {
  private readonly platformId = inject(PLATFORM_ID);

  /** Null when nothing is stored, storage is unavailable, or the stored value is not a known method. */
  public read(): OrgLensRoiMethod | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const stored = localStorage.getItem(ORG_LENS_ROI_METHOD_STORAGE_KEY);
      if (stored !== null && (ORG_LENS_ROI_METHODS as readonly string[]).includes(stored)) {
        return stored as OrgLensRoiMethod;
      }
    } catch {
      // Ignore unavailable storage.
    }
    return null;
  }

  public write(method: OrgLensRoiMethod): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(ORG_LENS_ROI_METHOD_STORAGE_KEY, method);
    } catch {
      // Ignore unavailable storage.
    }
  }
}

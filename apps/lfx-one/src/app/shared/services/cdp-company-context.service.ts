// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';
import type { CdpCompanyNavContext, CdpCompanyPage, CdpCompanySection, CdpSectionKey } from '@lfx-one/shared/interfaces';

/**
 * The CDP company on screen (spec 062), shared between the company shell, its section pages and the Company Lens
 * navigation. Held in memory only: a CDP id is never a selected B2B company, so it never reaches the account context,
 * its cookie or the role-grants cache (FR-021).
 */
@Injectable({ providedIn: 'root' })
export class CdpCompanyContextService {
  private readonly current = signal<CdpCompanyNavContext | null>(null);

  /** The CDP address on screen; null off CDP routes. */
  public readonly context = this.current.asReadonly();

  /** The page the server answered for the CDP address on screen, when it answered one. */
  public readonly page = computed((): CdpCompanyPage | null => this.current()?.page ?? null);

  /** A CDP page is on screen and the shell is still waiting for its answer. */
  public readonly pending = computed((): boolean => {
    const current = this.current();
    return current !== null && !current.settled;
  });

  /** The shell starts on a CDP address: any answer held for another id is dropped. */
  public enter(cdpId: string): void {
    this.current.set({ cdpId, page: null, settled: false });
  }

  /** The shell's answer for `cdpId`: the page, or null when the address opens no page. Ignored once the shell moved on. */
  public settle(cdpId: string, page: CdpCompanyPage | null): void {
    if (this.current()?.cdpId !== cdpId) return;
    this.current.set({ cdpId, page, settled: true });
  }

  /** The shell left the CDP address. */
  public leave(cdpId: string): void {
    if (this.current()?.cdpId === cdpId) this.current.set(null);
  }

  /** The server's state for one section of the page on screen; undefined when the page does not list it. */
  public sectionState(key: CdpSectionKey): CdpCompanySection['state'] | undefined {
    return this.page()?.sections.find((section) => section.key === key)?.state;
  }
}

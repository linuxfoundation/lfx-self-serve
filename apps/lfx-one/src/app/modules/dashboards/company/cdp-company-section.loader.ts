// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { CdpCompanySectionResult, CdpSectionKey, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { CdpCompanyContextService } from '@services/cdp-company-context.service';
import { CdpCompanyService } from '@services/cdp-company.service';
import { catchError, map, Observable, of, startWith, switchMap } from 'rxjs';

import { cdpCompanySectionEmptyState, classifyCdpSectionError, isCdpSectionEmpty } from './cdp-company.util';

/**
 * Reads one section of the CDP company on screen for a section page. Construct it in a component field
 * initializer (it injects). The section is requested only when the page the shell holds marks it `on`: an off section,
 * or one the page does not list, renders "off by design" without a request; a refusal renders by its code.
 */
export class CdpCompanySectionLoader<K extends CdpSectionKey> {
  private readonly context = inject(CdpCompanyContextService);
  private readonly cdpCompanyService = inject(CdpCompanyService);
  private readonly attempt = signal(0);

  public readonly result: Signal<CdpCompanySectionResult<K>>;
  public readonly state = computed(() => this.result().state);
  public readonly data = computed(() => this.result().data);
  /** The shared empty state to render in place of the section's content; null while loading and when it has content. */
  public readonly emptyState: Signal<OrgLensEmptyStateName | null> = computed(() => cdpCompanySectionEmptyState(this.state()));
  /** The company's name, for the section's "nothing recorded" wording; the caller can already read it on the page. */
  public readonly companyName = computed(() => this.context.page()?.company.name ?? '');

  public constructor(private readonly key: K) {
    this.result = this.initResult();
  }

  /** Re-reads the section after a failed or unverifiable answer. */
  public retry(): void {
    this.attempt.update((attempt) => attempt + 1);
  }

  private initResult(): Signal<CdpCompanySectionResult<K>> {
    const loading: CdpCompanySectionResult<K> = { state: 'loading', data: null };
    const request = computed(
      () => ({
        cdpId: this.context.page() ? (this.context.context()?.cdpId ?? null) : null,
        sectionState: this.context.sectionState(this.key),
        attempt: this.attempt(),
      }),
      { equal: (a, b) => a.cdpId === b.cdpId && a.sectionState === b.sectionState && a.attempt === b.attempt }
    );
    return toSignal(
      toObservable(request).pipe(
        switchMap(({ cdpId, sectionState }): Observable<CdpCompanySectionResult<K>> => {
          if (!cdpId) return of(loading);
          if (sectionState !== 'on') return of({ state: 'off-by-design', data: null });
          return this.cdpCompanyService.getSection(cdpId, this.key).pipe(
            map((data): CdpCompanySectionResult<K> => ({ state: isCdpSectionEmpty(data) ? 'empty' : 'ready', data })),
            catchError((error: unknown) => of<CdpCompanySectionResult<K>>({ state: classifyCdpSectionError(error), data: null })),
            startWith(loading)
          );
        })
      ),
      { initialValue: loading }
    );
  }
}

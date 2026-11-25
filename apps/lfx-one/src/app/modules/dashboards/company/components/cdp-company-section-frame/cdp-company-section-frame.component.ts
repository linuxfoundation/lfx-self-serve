// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { CDP_COMPANY_SECTION_EMPTY_NOUN, CDP_COMPANY_SECTION_META } from '@lfx-one/shared/constants';
import type {
  CdpCompanySectionMeta,
  CdpCompanySectionViewState,
  CdpSectionKey,
  OrgLensEmptyStateName,
  OrgLensEmptyStateValues,
} from '@lfx-one/shared/interfaces';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { SkeletonModule } from 'primeng/skeleton';

/**
 * The frame every CDP section page shares: its page header, then a skeleton while loading, the shared
 * Company Lens empty state for off, refused, failed and empty answers, or the projected content once ready.
 */
@Component({
  selector: 'lfx-cdp-company-section-frame',
  imports: [OrgLensEmptyStateComponent, PageHeaderComponent, SkeletonModule],
  templateUrl: './cdp-company-section-frame.component.html',
})
export class CdpCompanySectionFrameComponent {
  public readonly sectionKey = input.required<CdpSectionKey>();
  public readonly state = input.required<CdpCompanySectionViewState>();
  public readonly emptyState = input<OrgLensEmptyStateName | null>(null);
  public readonly companyName = input<string>('');

  public readonly retry = output<void>();

  protected readonly meta: Signal<CdpCompanySectionMeta> = computed(() => CDP_COMPANY_SECTION_META[this.sectionKey()]);
  protected readonly testIdPrefix = computed(() => `cdp-company-${this.sectionKey()}`);
  /** "Nothing recorded" names the company the caller is looking at; no period or filter applies to a CDP section. */
  protected readonly emptyStateValues: Signal<OrgLensEmptyStateValues> = computed(() => ({
    orgName: this.companyName(),
    noun: CDP_COMPANY_SECTION_EMPTY_NOUN[this.sectionKey()] ?? 'activity',
    filterActive: false,
  }));
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, Signal } from '@angular/core';
import type { CdpCompanyGroupRow } from '@lfx-one/shared/interfaces';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';

import { CdpCompanySectionFrameComponent } from '../components/cdp-company-section-frame/cdp-company-section-frame.component';
import { CdpCompanySectionLoader } from '../cdp-company-section.loader';

/**
 * CDP Groups: active seats per committee or board, behind its server flag and for LF staff
 * only. Seat holders are never shown. Off renders "off by design"; any other caller in the audience gets no access.
 */
@Component({
  selector: 'lfx-cdp-company-groups',
  imports: [CdpCompanySectionFrameComponent, CardComponent, TableComponent, DecimalPipe],
  templateUrl: './cdp-company-groups.component.html',
})
export class CdpCompanyGroupsComponent {
  protected readonly section = new CdpCompanySectionLoader('groups');

  protected readonly rows: Signal<CdpCompanyGroupRow[]> = computed(() => this.section.data()?.rows ?? []);
}

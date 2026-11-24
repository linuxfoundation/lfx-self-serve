// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, Signal } from '@angular/core';
import type { CdpCompanyMeetingRow } from '@lfx-one/shared/interfaces';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';

import { CdpCompanySectionFrameComponent } from '../components/cdp-company-section-frame/cdp-company-section-frame.component';
import { CdpCompanySectionLoader } from '../cdp-company-section.loader';

/**
 * CDP Meetings: attendance per project and meeting type, behind its server flag and for LF
 * staff only. Off renders "off by design"; any other caller in the audience gets the no-access state.
 */
@Component({
  selector: 'lfx-cdp-company-meetings',
  imports: [CdpCompanySectionFrameComponent, CardComponent, TableComponent, DecimalPipe],
  templateUrl: './cdp-company-meetings.component.html',
})
export class CdpCompanyMeetingsComponent {
  protected readonly section = new CdpCompanySectionLoader('meetings');

  protected readonly rows: Signal<CdpCompanyMeetingRow[]> = computed(() => this.section.data()?.rows ?? []);
}

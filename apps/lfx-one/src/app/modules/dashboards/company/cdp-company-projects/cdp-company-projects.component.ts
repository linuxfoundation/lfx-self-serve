// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, Signal } from '@angular/core';
import type { CdpCompanyProjectRow } from '@lfx-one/shared/interfaces';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';

import { CdpCompanySectionFrameComponent } from '../components/cdp-company-section-frame/cdp-company-section-frame.component';
import { CdpCompanySectionLoader } from '../cdp-company-section.loader';

/** CDP Projects (spec 062 FR-018, FR-020): LF projects the caller may view, with two-year contributor and activity counts. */
@Component({
  selector: 'lfx-cdp-company-projects',
  imports: [CdpCompanySectionFrameComponent, CardComponent, TableComponent, DecimalPipe],
  templateUrl: './cdp-company-projects.component.html',
})
export class CdpCompanyProjectsComponent {
  protected readonly section = new CdpCompanySectionLoader('projects');

  protected readonly rows: Signal<CdpCompanyProjectRow[]> = computed(() => this.section.data()?.rows ?? []);
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CurrencyPipe } from '@angular/common';
import { Component, model } from '@angular/core';
import { ORG_LENS_ROI_GLOBAL_ASSUMPTIONS, ORG_LENS_ROI_METHOD_LABELS, ORG_LENS_ROI_METHODS } from '@lfx-one/shared/constants';
import type { OrgLensRoiMethod } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';

@Component({
  selector: 'lfx-org-roi-assumptions-drawer',
  imports: [DrawerModule, CurrencyPipe],
  templateUrl: './org-roi-assumptions-drawer.component.html',
})
export class OrgRoiAssumptionsDrawerComponent {
  public readonly visible = model<boolean>(false);
  public readonly method = model.required<OrgLensRoiMethod>();

  protected readonly methods = ORG_LENS_ROI_METHODS;
  protected readonly methodLabels = ORG_LENS_ROI_METHOD_LABELS;
  protected readonly assumptions = ORG_LENS_ROI_GLOBAL_ASSUMPTIONS;

  protected onSelectMethod(method: OrgLensRoiMethod): void {
    if (method === this.method()) return;
    this.method.set(method);
  }

  protected onClose(): void {
    this.visible.set(false);
  }
}

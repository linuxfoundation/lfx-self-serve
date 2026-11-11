// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, model } from '@angular/core';
import { ORG_LENS_ROI_DEFAULT_METHOD, ORG_LENS_ROI_METHOD_DESCRIPTIONS, ORG_LENS_ROI_METHOD_LABELS, ORG_LENS_ROI_METHODS } from '@lfx-one/shared/constants';
import type { OrgLensRoiMethod } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';

@Component({
  selector: 'lfx-org-roi-settings-drawer',
  imports: [DrawerModule],
  templateUrl: './org-roi-settings-drawer.component.html',
})
export class OrgRoiSettingsDrawerComponent {
  public readonly visible = model<boolean>(false);
  public readonly method = model.required<OrgLensRoiMethod>();

  protected readonly methods = ORG_LENS_ROI_METHODS;
  protected readonly methodLabels = ORG_LENS_ROI_METHOD_LABELS;
  protected readonly methodDescriptions = ORG_LENS_ROI_METHOD_DESCRIPTIONS;

  /** Read from the constant rather than hard-coded, so the badge follows a change of default. */
  protected readonly defaultMethod = ORG_LENS_ROI_DEFAULT_METHOD;

  protected onSelectMethod(method: OrgLensRoiMethod): void {
    if (method === this.method()) return;
    this.method.set(method);
  }

  protected onClose(): void {
    this.visible.set(false);
  }
}

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CurrencyPipe } from '@angular/common';
import { Component } from '@angular/core';
import { ORG_LENS_ROI_DOCS_URL, ORG_LENS_ROI_GLOBAL_ASSUMPTIONS, ORG_LENS_ROI_MODEL_OVERVIEW, ORG_LENS_ROI_SURVEY_URL } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-org-roi-model-overview',
  imports: [CurrencyPipe],
  templateUrl: './org-roi-model-overview.component.html',
})
export class OrgRoiModelOverviewComponent {
  protected readonly copy = ORG_LENS_ROI_MODEL_OVERVIEW;
  protected readonly assumptions = ORG_LENS_ROI_GLOBAL_ASSUMPTIONS;
  protected readonly surveyUrl = ORG_LENS_ROI_SURVEY_URL;

  /** Empty while the staff documentation is unpublished, which leaves the link unrendered. */
  protected readonly docsUrl = ORG_LENS_ROI_DOCS_URL;
}

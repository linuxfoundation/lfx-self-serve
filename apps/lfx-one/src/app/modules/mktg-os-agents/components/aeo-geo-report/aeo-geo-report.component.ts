// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { AeoGeoReport } from '@lfx-one/shared/interfaces';
import { aeoGeoHttpLink } from '@lfx-one/shared/utils';

/** The validated structured report, shared by the web view and browser-print PDF. */
@Component({
  selector: 'lfx-aeo-geo-report',
  templateUrl: './aeo-geo-report.component.html',
  styleUrl: './aeo-geo-report.component.scss',
})
export class AeoGeoReportComponent {
  public readonly report = input.required<AeoGeoReport>();
  public readonly showHeadline = input(true);
  protected readonly findings = this.initFindings();
  protected readonly sources = computed(() => this.report().sources.map((source) => ({ ...source, href: aeoGeoHttpLink(source.url) })));

  private initFindings() {
    return computed(() =>
      this.report().findings.map((finding) => ({ ...finding, evidence: finding.evidence.map((text) => ({ text, href: aeoGeoHttpLink(text) })) }))
    );
  }
}

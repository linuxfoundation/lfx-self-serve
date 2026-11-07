// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { AeoGeoReport } from '@lfx-one/shared/interfaces';
import { aeoGeoHttpLink, aeoGeoReaderCaveat } from '@lfx-one/shared/utils';

/** The validated structured report, shared by the web view and browser-print PDF. */
@Component({
  selector: 'lfx-aeo-geo-report',
  imports: [MarkdownRendererComponent],
  templateUrl: './aeo-geo-report.component.html',
  styleUrl: './aeo-geo-report.component.scss',
})
export class AeoGeoReportComponent {
  public readonly report = input.required<AeoGeoReport>();
  public readonly showHeadline = input(true);
  protected readonly findings = this.initFindings();
  protected readonly sources = computed(() => this.report().sources.map((source) => ({ ...source, href: aeoGeoHttpLink(source.url) })));
  // Reader sentences: the agent's caveats name fields, slugs, uids and raw provider errors, and the report prints none of them.
  protected readonly caveats = computed(() => this.report().caveats.map(aeoGeoReaderCaveat));

  private initFindings() {
    return computed(() =>
      this.report().findings.map((finding) => ({ ...finding, evidence: finding.evidence.map((text) => ({ text, href: aeoGeoHttpLink(text) })) }))
    );
  }
}

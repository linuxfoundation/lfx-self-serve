// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { AEO_GEO_SOURCES_KEEP_TOGETHER_MAX } from '@lfx-one/shared/constants';
import { AeoGeoReport } from '@lfx-one/shared/interfaces';
import { aeoGeoHttpLink, aeoGeoReaderCaveats } from '@lfx-one/shared/utils';

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
  // Reader sentences, each once: the known plumbing shapes in a caveat are mapped or left out; other text passes through unchanged.
  protected readonly caveats = computed(() => aeoGeoReaderCaveats(this.report().caveats));
  // A short Sources list prints as one block with its heading (its last lines never alone on a page); a long one flows.
  protected readonly keepSourcesTogether = computed(() => this.report().sources.length <= AEO_GEO_SOURCES_KEEP_TOGETHER_MAX);

  private initFindings() {
    return computed(() =>
      this.report().findings.map((finding) => ({ ...finding, evidence: finding.evidence.map((text) => ({ text, href: aeoGeoHttpLink(text) })) }))
    );
  }
}

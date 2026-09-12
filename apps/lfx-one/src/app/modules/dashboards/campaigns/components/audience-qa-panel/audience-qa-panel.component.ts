// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CampaignService } from '@services/campaign.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';

import type { AudienceQaCandidate, AudienceQaCheckRow, AudienceQaFinding, AudienceQaReport, AudienceQaResult } from '@lfx-one/shared/interfaces';
import { rowsToCsv } from '@lfx-one/shared/utils';

/**
 * Audience QA: run the three checks against a built list and report what has to be fixed.
 *
 * This panel calls the service itself rather than taking a result as an input — the same shape
 * `audience-demographics` uses. QA is read-only and independent of the composition selections, so
 * routing it through the container would only add a hop.
 */
@Component({
  selector: 'lfx-audience-qa-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './audience-qa-panel.component.html',
  styleUrl: './audience-qa-panel.component.scss',
})
export class AudienceQaPanelComponent {
  // === Services ===
  private readonly campaignService = inject(CampaignService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly projectSlug = input.required<string>();
  public readonly disabled = input(false);

  // === Forms ===
  protected readonly listRefControl = new FormControl('', { nonNullable: true });
  protected readonly targetsEuControl = new FormControl(false, { nonNullable: true });
  protected readonly targetsCaControl = new FormControl(false, { nonNullable: true });

  // === State ===
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<AudienceQaResult | null>(null);

  // === Computed Signals ===
  /**
   * The two arms of the result union, split here rather than narrowed in the template.
   *
   * `AudienceQaResult` is discriminated on `needsDisambiguation` precisely so the ambiguous branch
   * cannot be read as if it carried checks; narrowing it in the template would put that guarantee
   * at the mercy of template type-checking settings, so the split happens in TypeScript.
   */
  protected readonly candidates = computed(() => {
    const result = this.result();
    return result !== null && result.needsDisambiguation ? result.candidates : null;
  });

  protected readonly report = computed(() => {
    const result = this.result();
    return result !== null && !result.needsDisambiguation ? result : null;
  });

  /** The three checks in report order, flattened for rendering and for the CSV. */
  protected readonly checkRows = computed(() => {
    const report = this.report();
    return report === null ? [] : this.flattenChecks(report);
  });

  public constructor() {
    // Disabling a reactive control goes through the CONTROL, not a `[disabled]` binding on the
    // element: the binding fights the ReactiveForms directive and Angular warns it can produce a
    // changed-after-checked error. The container documents the same rule for its own url control.
    // All three controls move together, so one subscription covers them.
    toObservable(this.disabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((disabled) => {
        for (const control of [this.listRefControl, this.targetsEuControl, this.targetsCaControl]) {
          if (disabled) {
            control.disable({ emitEvent: false });
          } else {
            control.enable({ emitEvent: false });
          }
        }
      });
  }

  // === Protected Methods ===
  protected onRun(listRef?: string): void {
    const ref = (listRef ?? this.listRefControl.value).trim();
    if (this.disabled() || this.running() || ref.length === 0) {
      return;
    }

    this.running.set(true);
    this.error.set(null);
    // Clear the VERDICT too, not just the error. A previous PASS left on screen while a new
    // audit runs against a different list reads as that list's verdict — an operator seeing
    // PASS beside the reference they just typed has no way to tell it belongs to the last one.
    // The error path already cleared itself for exactly this reason.
    this.result.set(null);
    this.campaignService
      .runAudienceQa(this.projectSlug(), { listRef: ref, targetsEu: this.targetsEuControl.value, targetsCa: this.targetsCaControl.value })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.running.set(false);
        },
        error: (httpErr: HttpErrorResponse) => {
          this.error.set(extractErrorMessage(httpErr, 'Failed to run audience QA'));
          this.result.set(null);
          this.running.set(false);
        },
      });
  }

  /** Re-run against one of the candidates the server returned for an ambiguous name. */
  protected onPickCandidate(candidate: AudienceQaCandidate): void {
    this.listRefControl.setValue(candidate.listId);
    this.onRun(candidate.listId);
  }

  protected verdictClass(verdict: string): string {
    if (verdict === 'PASS') {
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    }
    if (verdict === 'FAIL') {
      return 'bg-red-50 text-red-700 ring-red-200';
    }
    return 'bg-amber-50 text-amber-700 ring-amber-200';
  }

  protected severityClass(severity: AudienceQaFinding['severity']): string {
    if (severity === 'CRITICAL') {
      return 'bg-red-100 text-red-800';
    }
    if (severity === 'HIGH') {
      return 'bg-amber-100 text-amber-800';
    }
    return 'bg-gray-100 text-gray-700';
  }

  protected sizeLabel(size?: number): string {
    return size === undefined ? 'size unknown' : `${size.toLocaleString('en-US')} contacts`;
  }

  /** Download the findings as CSV. Built client-side — the report is already fully in hand. */
  protected onDownloadCsv(): void {
    const result = this.result();
    if (result === null || result.needsDisambiguation) {
      return;
    }

    const rows: (string | number)[][] = [['List ID', 'List name', 'Overall verdict', 'Check', 'Check verdict', 'Severity', 'Finding', 'Suggested fix']];

    for (const check of this.flattenChecks(result)) {
      if (check.findings.length === 0) {
        rows.push([result.listId, result.name, result.overall, check.name, check.verdict, '', 'No findings', '']);
        continue;
      }
      for (const finding of check.findings) {
        rows.push([result.listId, result.name, result.overall, check.name, check.verdict, finding.severity, finding.message, finding.fix]);
      }
    }

    if (typeof document === 'undefined') {
      return; // SSR guard — unreachable in the browser
    }
    const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `audience-qa-${result.listId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // === Private Methods ===
  private flattenChecks(report: AudienceQaReport): readonly AudienceQaCheckRow[] {
    return [
      {
        key: 'signalMapping',
        name: 'Signal mapping',
        verdict: report.checks.signalMapping.verdict,
        findings: report.checks.signalMapping.findings,
        note: null,
      },
      {
        key: 'suppression',
        name: 'Suppression',
        verdict: report.checks.suppression.verdict,
        findings: report.checks.suppression.findings,
        note: `GDPR ${report.checks.suppression.applied.gdpr ? 'applied' : 'not applied'} · global opt-out ${
          report.checks.suppression.applied.optOut ? 'applied' : 'not applied'
        }`,
      },
      {
        key: 'exclusionCompleteness',
        name: 'Exclusion completeness',
        verdict: report.checks.exclusionCompleteness.verdict,
        findings: report.checks.exclusionCompleteness.findings,
        note: `${report.checks.exclusionCompleteness.exclusionCount} exclusion filter(s) on the list`,
      },
    ];
  }
}

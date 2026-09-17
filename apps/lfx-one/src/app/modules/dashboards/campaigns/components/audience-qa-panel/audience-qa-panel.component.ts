// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CampaignService } from '@services/campaign.service';
import { distinctUntilChanged, skip } from 'rxjs';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';

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
  /**
   * The inputs the displayed verdict was actually computed from.
   *
   * The controls stay editable while a run is in flight and after it returns, so a verdict can
   * sit beside a jurisdiction checkbox toggled after submission — an operator would read a PASS
   * as covering EU or Canadian targeting that was never audited. Showing the submitted values
   * beside the result is stronger than disabling the controls: it stays true once the request
   * has finished and the controls are live again.
   */
  protected readonly submitted = signal<{ listRef: string; targetsEu: boolean; targetsCa: boolean } | null>(null);
  /**
   * Which project the in-flight QA request belongs to.
   *
   * The parent stays mounted across foundation changes and this child watched nothing, so a
   * PASS or candidate list from portal A survived into portal B — and picking a candidate then
   * submitted an A-scoped list id against B, auditing a list that portal does not hold.
   */
  private runGeneration = 0;

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
  /**
   * Rows and badges pre-decorated with their display strings and class lists, so the template
   * reads properties instead of calling sizeLabel()/verdictClass()/severityClass() on every
   * change-detection pass (`docs/reviews/frontend-checklist.md` §4).
   */
  protected readonly checkRows = computed(() => {
    const report = this.report();
    if (report === null) {
      return [];
    }
    return this.flattenChecks(report).map((check) => ({
      ...check,
      verdictCss: this.verdictClass(check.verdict),
      findings: check.findings.map((finding) => ({ ...finding, severityCss: this.severityClass(finding.severity) })),
    }));
  });

  protected readonly candidateRows = computed(
    () => this.candidates()?.map((candidate) => ({ ...candidate, sizeText: this.sizeLabel(candidate.size) })) ?? null
  );

  protected readonly overallCss = computed(() => {
    const report = this.report();
    return report === null ? '' : this.verdictClass(report.overall);
  });

  public constructor() {
    // A project change invalidates any in-flight QA request and clears the verdict, for the
    // same reason the parent resets its run state: the container stays mounted, so portal A's
    // PASS would otherwise be read as portal B's.
    toObservable(this.projectSlug)
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.runGeneration += 1;
        this.result.set(null);
        this.error.set(null);
        this.running.set(false);
        this.listRefControl.setValue('', { emitEvent: false });
      });

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
    const run = this.runGeneration;
    // Clear the VERDICT too, not just the error. A previous PASS left on screen while a new
    // audit runs against a different list reads as that list's verdict — an operator seeing
    // PASS beside the reference they just typed has no way to tell it belongs to the last one.
    // The error path already cleared itself for exactly this reason.
    this.result.set(null);
    const targetsEu = this.targetsEuControl.value;
    const targetsCa = this.targetsCaControl.value;
    this.submitted.set({ listRef: ref, targetsEu, targetsCa });
    this.campaignService
      .runAudienceQa(this.projectSlug(), { listRef: ref, targetsEu, targetsCa })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.result.set(result);
          this.running.set(false);
        },
        error: (httpErr: HttpErrorResponse) => {
          if (run !== this.runGeneration) {
            return;
          }
          // serverAuthoredMessage, matching discover/preview/compose: extractErrorMessage ends
          // in `error.message || fallback` and HttpErrorResponse.message is never empty, so a
          // body-less failure leaked Angular's "Http failure response for ..." to the operator.
          this.error.set(serverAuthoredMessage(httpErr, 'Failed to run audience QA'));
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

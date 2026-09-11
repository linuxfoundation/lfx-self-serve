// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CampaignService } from '@services/campaign.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudienceQaChecks, AudienceQaResult } from '@lfx-one/shared/interfaces';

import { AudienceQaPanelComponent } from './audience-qa-panel.component';

function checks(overrides: Partial<AudienceQaChecks> = {}): AudienceQaChecks {
  return {
    signalMapping: { verdict: 'PASS', findings: [] },
    suppression: { verdict: 'PASS', findings: [], applied: { gdpr: true, optOut: true } },
    exclusionCompleteness: { verdict: 'PASS', findings: [], exclusionCount: 1 },
    ...overrides,
  };
}

function report(overrides: Partial<Extract<AudienceQaResult, { needsDisambiguation: false }>> = {}): AudienceQaResult {
  return {
    needsDisambiguation: false,
    listId: '601',
    name: '26Q1 - SYN - Synthetic Summit - Master',
    hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/601',
    checks: checks(),
    findings: [],
    overall: 'PASS',
    ...overrides,
  };
}

describe('AudienceQaPanelComponent', () => {
  let fixture: ComponentFixture<AudienceQaPanelComponent>;
  const runAudienceQa = vi.fn();

  beforeEach(async () => {
    runAudienceQa.mockReset();
    await TestBed.configureTestingModule({
      imports: [AudienceQaPanelComponent],
      providers: [{ provide: CampaignService, useValue: { runAudienceQa } }],
    }).compileComponents();

    fixture = TestBed.createComponent(AudienceQaPanelComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('disabled', false);
    fixture.detectChanges();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function enterRefAndRun(value = '601'): void {
    const input = host().querySelector<HTMLInputElement>('[data-testid="audience-qa-panel-list-ref"]');
    if (input === null) {
      throw new Error('the list-ref input is not rendered');
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    host().querySelector<HTMLButtonElement>('[data-testid="audience-qa-panel-run"]')?.click();
    fixture.detectChanges();
  }

  it('renders the verdict and every check for a resolved report', () => {
    runAudienceQa.mockReturnValue(of(report()));
    enterRefAndRun();

    expect(host().querySelector('[data-testid="audience-qa-panel-overall"]')?.textContent?.trim()).toBe('PASS');
    for (const key of ['signalMapping', 'suppression', 'exclusionCompleteness']) {
      expect(host().querySelector(`[data-testid="audience-qa-panel-check-${key}"]`), `${key} was not rendered`).not.toBeNull();
    }
  });

  it('shows candidates and no verdict when the name matched several lists', () => {
    // `AudienceQaResult` is a union discriminated on `needsDisambiguation` precisely so the
    // ambiguous arm cannot be read as if it carried an `overall`. Rendering a verdict here would
    // QA a list the operator is not about to send to.
    runAudienceQa.mockReturnValue(
      of<AudienceQaResult>({
        needsDisambiguation: true,
        candidates: [
          { listId: '701', name: 'Synthetic Summit - Master (EU)', size: 800 },
          { listId: '702', name: 'Synthetic Summit - Master (NA)', size: 1500 },
        ],
      })
    );
    enterRefAndRun('Synthetic Summit - Master');

    expect(host().querySelector('[data-testid="audience-qa-panel-candidates"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="audience-qa-panel-overall"]'), 'an ambiguous result rendered a verdict').toBeNull();
    expect(host().querySelector('[data-testid="audience-qa-panel-download-csv"]'), 'an ambiguous result offered a CSV').toBeNull();
  });

  it('re-runs against the picked candidate id, not the ambiguous name', () => {
    runAudienceQa.mockReturnValueOnce(
      of<AudienceQaResult>({ needsDisambiguation: true, candidates: [{ listId: '702', name: 'Synthetic Summit - Master (NA)' }] })
    );
    enterRefAndRun('Synthetic Summit - Master');

    runAudienceQa.mockReturnValueOnce(of(report({ listId: '702' })));
    host().querySelector<HTMLElement>('[data-testid="audience-qa-panel-candidate-702"]')?.click();
    fixture.detectChanges();

    expect(runAudienceQa).toHaveBeenLastCalledWith('tlf', expect.objectContaining({ listRef: '702' }));
    expect(host().querySelector('[data-testid="audience-qa-panel-overall"]')).not.toBeNull();
  });

  it('passes the jurisdiction flags through, since they decide which suppressions are required', () => {
    const euCheckbox = host().querySelector<HTMLInputElement>('[data-testid="audience-qa-panel-targets-eu"]');
    euCheckbox!.click();
    fixture.detectChanges();

    runAudienceQa.mockReturnValue(of(report()));
    enterRefAndRun();

    expect(runAudienceQa).toHaveBeenCalledWith('tlf', { listRef: '601', targetsEu: true, targetsCa: false });
  });

  it('surfaces the upstream reason rather than Angular generic text', () => {
    // A real HttpErrorResponse: `extractErrorMessage` narrows on `instanceof`, so a plain object
    // shaped like one takes the fallback path and proves nothing about the helper being wired.
    runAudienceQa.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'No list matched that reference.' } })));
    enterRefAndRun();

    expect(host().querySelector('[data-testid="audience-qa-panel-error"]')?.textContent).toContain('No list matched that reference.');
  });

  it('clears a stale report when a later run fails', () => {
    // A failed re-run that left the previous PASS on screen would read as "this list still passes",
    // which is the one thing QA must never say about a list it did not just check.
    runAudienceQa.mockReturnValueOnce(of(report()));
    enterRefAndRun();
    expect(host().querySelector('[data-testid="audience-qa-panel-overall"]')).not.toBeNull();

    runAudienceQa.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'HubSpot is unavailable.' } })));
    host().querySelector<HTMLButtonElement>('[data-testid="audience-qa-panel-run"]')?.click();
    fixture.detectChanges();

    expect(host().querySelector('[data-testid="audience-qa-panel-overall"]'), 'a stale verdict survived a failed re-run').toBeNull();
  });

  it('does not run with an empty reference', () => {
    host().querySelector<HTMLButtonElement>('[data-testid="audience-qa-panel-run"]')?.click();
    fixture.detectChanges();

    expect(runAudienceQa).not.toHaveBeenCalled();
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Member360Service } from '@services/member-360.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { member360Fixture } from '../../../../../../e2e/fixtures/mock-data/member-360.mock';
import { SYNTHETIC_ORG_NAME, SYNTHETIC_SECOND_ORG_LEGAL_NAME } from '../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { Member360ResultComponent } from './member-360-result.component';

describe('Member360ResultComponent', () => {
  const api = { download: vi.fn(() => of(new Blob(['workbook']))) };
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([]), provideNoopAnimations(), { provide: Member360Service, useValue: api }] }));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  function render(envelope = member360Fixture()) {
    const fixture = TestBed.createComponent(Member360ResultComponent);
    for (const [key, value] of Object.entries({ envelope, documentId: 'run-0123456789abcdef01234567', project: 'sample-project' }))
      fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    const query = (id: string): HTMLElement => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
    const names = () =>
      Array.from(fixture.nativeElement.querySelectorAll('[data-testid="member-360-ranking-row"] button') as NodeListOf<HTMLButtonElement>).map((button) =>
        button.textContent?.trim()
      );
    const sort = (key: string) => {
      query(`member-360-sort-${key}`).click();
      fixture.detectChanges();
    };
    return { fixture, component: fixture.componentInstance, query, names, sort };
  }
  it('shows an em dash for an empty score range', () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking = [];
    expect(render(envelope).query('member-360-summary-scores').querySelector('b')?.textContent?.trim()).toBe('—');
  });
  it('expands only one duplicate-name row and preserves its identity when sorting', () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[1].member_organization = envelope.tabs.member_ranking[0].member_organization;
    const view = render(envelope);
    const buttons = view.fixture.nativeElement.querySelectorAll('[data-testid="member-360-ranking-row"] button') as NodeListOf<HTMLButtonElement>;
    expect(buttons[0].getAttribute('aria-controls')).not.toBe(buttons[1].getAttribute('aria-controls'));
    buttons[0].click();
    view.fixture.detectChanges();
    expect(view.fixture.nativeElement.querySelectorAll('[data-testid="member-360-row-detail"]')).toHaveLength(1);
    const id = view.query('member-360-row-detail').id;
    view.sort('engagement_score');
    expect(view.query('member-360-row-detail').id).toBe(id);
  });
  it('formats date-only run and window fields in UTC', () => {
    const envelope = member360Fixture();
    envelope.run_date = envelope.period.window_start = envelope.period.window_end = '2026-10-01';
    expect(render(envelope).query('member-360-result-header').textContent).toContain('Run 1 Oct 2026 · window Oct 2026 to');
  });
  it('ignores stray trend glyphs when no prior run was provided', () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[1].trend = '▼';
    const view = render(envelope);
    expect(view.query('member-360-trend').textContent?.trim()).toBe('—');
    expect(view.query('member-360-trend').getAttribute('data-trend')).toBe('none');
    expect(view.query('member-360-trend').getAttribute('aria-label')).toBe('no trend');
  });
  it('uses only contract-provided mover deltas and never invents zero for other members', () => {
    const envelope = member360Fixture();
    envelope.inputs.prior_run_provided = true;
    envelope.tabs.member_ranking[0].trend = '▼';
    envelope.tabs.member_ranking[1].trend = '▲';
    envelope.tabs.summary.movers = { gainers: [], decliners: [{ member_organization: SYNTHETIC_ORG_NAME, delta: -11 }] };
    const view = render(envelope);
    expect(view.query('member-360-trend').textContent?.trim()).toBe('▲');
    view.sort('engagement_score');
    expect(view.query('member-360-trend').textContent?.trim()).toBe('▼ 11');
    envelope.tabs.member_ranking[0].trend = null;
    view.fixture.componentRef.setInput('envelope', { ...envelope });
    view.fixture.detectChanges();
    expect(view.query('member-360-trend').textContent?.trim()).toBe('—');
    expect(view.query('member-360-trend').getAttribute('aria-label')).toBe('no trend');
  });
  it('keeps unknown renewals last in either direction and includes day 120 in the header', () => {
    const envelope = member360Fixture();
    envelope.tabs.member_ranking[0].days_to_renewal = null;
    envelope.tabs.member_ranking[1].days_to_renewal = 120;
    const view = render(envelope);
    view.sort('days_to_renewal');
    expect(view.names()[0]).toBe(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
    view.sort('days_to_renewal');
    expect(view.names()[0]).toBe(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
    expect(view.query('member-360-summary-renewals').querySelector('b')?.textContent?.trim()).toBe('1');
    expect(view.query('member-360-ranking').textContent).toContain('Unknown');
    expect(view.query('member-360-ranking').querySelector('[role="img"]')?.getAttribute('tabindex')).toBe('0');
  });
  it('downloads the stored BFF workbook and exposes a download failure', async () => {
    const view = render();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:synthetic'), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    await view.component['download']();
    expect(api.download).toHaveBeenCalledWith('sample-project', 'run-0123456789abcdef01234567');
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
    api.download.mockReturnValueOnce(throwError(() => new Error('unavailable')));
    await view.component['download']();
    view.fixture.detectChanges();
    expect(view.query('member-360-notice').textContent).toContain('could not be prepared');
    await view.component['download']();
    view.fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

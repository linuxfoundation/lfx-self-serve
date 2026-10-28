// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HEALTH_METRICS_OVERVIEW_EMPTY_COPY } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { OverviewCardComponent } from './overview-card.component';

import type { HealthMetricsOverviewCardStatus } from '@lfx-one/shared/interfaces';

/** The card with an action, an empty-state action and a body, as a real card projects them. */
const HOST_TEMPLATE =
  '<lfx-overview-card heading="Outstanding balance" info="Unpaid invoices" [meta]="meta" [status]="status()" [isEmpty]="isEmpty()" [emptyCopy]="copy" testId="card" ><button overviewCardAction type="button" data-testid="card-action">Toggle</button><a overviewEmptyAction href="#" data-testid="card-empty-action">Add</a> <p data-testid="card-body">Body</p></lfx-overview-card >';

@Component({
  selector: 'lfx-overview-card-host',
  imports: [OverviewCardComponent],
  template: HOST_TEMPLATE,
})
class HostComponent {
  public readonly status = signal<HealthMetricsOverviewCardStatus>('loading');
  public readonly isEmpty = signal(false);
  protected readonly copy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.balance;
  protected readonly meta = [
    { label: 'As of:', value: 'today' },
    { label: 'Audience:', value: 'Board' },
  ];
}

describe('OverviewCardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function show(status: HealthMetricsOverviewCardStatus, isEmpty = false): void {
    fixture.componentInstance.status.set(status);
    fixture.componentInstance.isEmpty.set(isEmpty);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('titles the card and names its info icon', () => {
    expect(query('card-header')?.querySelector('h2')?.textContent).toBe('Outstanding balance');
    expect(query('card-header')?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Unpaid invoices');
    // The title's tip is the larger 14px question mark, opening below the icon.
    expect(query('card-header')?.querySelector('[role="img"]')?.className).toContain('text-[14px]');
    expect(query('card-action')).not.toBeNull();
  });

  it('shows a skeleton while reading, with no meta line or body', () => {
    expect(query('card-loading')).not.toBeNull();
    expect(query('card-meta')).toBeNull();
    expect(query('card-body')).toBeNull();
  });

  it('shows the error state, without the empty action, when the read fails', () => {
    show('failed');

    expect(query('card-error')?.textContent).toContain('Unavailable right now');
    expect(query('card-empty-action')).toBeNull();
    expect(query('card-body')).toBeNull();
  });

  it("shows the card's own empty state and its action when there is nothing to show", () => {
    show('ready', true);

    expect(query('card-empty')?.textContent).toContain('All invoices are paid');
    expect(query('card-empty-action')).not.toBeNull();
    expect(query('card-meta')).toBeNull();
  });

  it('projects the body and the meta line, values darker than labels, once ready', () => {
    show('ready');

    expect(query('card-body')).not.toBeNull();
    expect(query('card-meta')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('As of: today · Audience: Board');
    expect(query('card-meta')?.querySelector('span')?.className).toContain('text-gray-600');
    expect(query('card-empty')).toBeNull();
  });
});

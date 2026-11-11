// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiPaginationComponent } from './pagination.component';

@Component({
  selector: 'lfx-ui-pagination-test-host',
  imports: [UiPaginationComponent],
  template: `<lfx-ui-pagination [(page)]="page" [total]="total()" [pageSize]="pageSize()" />`,
})
class HostComponent {
  public readonly page = signal(0);
  public readonly total = signal(42);
  public readonly pageSize = signal(10);
}

describe('UiPaginationComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  const nav = (): HTMLElement | null => host.querySelector('[data-testid="ui-pagination-pages"]');
  const info = (): string => host.querySelector('[data-testid="ui-pagination-info"]')?.textContent?.trim() ?? '';
  const pageButtons = (): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll<HTMLElement>('[data-testid="ui-pagination-page"]')).map((el) => el.querySelector('button') as HTMLButtonElement);
  const labels = (): string[] => pageButtons().map((button) => button.textContent?.trim() ?? '');
  const previous = (): HTMLButtonElement => host.querySelector('[data-testid="ui-pagination-previous"] button') as HTMLButtonElement;
  const next = (): HTMLButtonElement => host.querySelector('[data-testid="ui-pagination-next"] button') as HTMLButtonElement;
  const update = async (changes: Partial<{ page: number; total: number; pageSize: number }>): Promise<void> => {
    if (changes.page !== undefined) fixture.componentInstance.page.set(changes.page);
    if (changes.total !== undefined) fixture.componentInstance.total.set(changes.total);
    if (changes.pageSize !== undefined) fixture.componentInstance.pageSize.set(changes.pageSize);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('renders a labelled nav with previous, the page numbers and next', () => {
    expect(nav()?.tagName).toBe('NAV');
    expect(nav()?.getAttribute('aria-label')).toBe('Pagination');
    expect(labels()).toEqual(['1', '2', '3', '4', '5']);
    expect(previous().getAttribute('aria-label')).toBe('Previous page');
    expect(next().getAttribute('aria-label')).toBe('Next page');
    expect(pageButtons()[2].getAttribute('aria-label')).toBe('Page 3');
  });

  it('shows the range of rows on the current page', async () => {
    expect(info()).toBe('Showing 1 to 10 of 42');

    await update({ page: 4 });

    expect(info()).toBe('Showing 41 to 42 of 42');
  });

  it('formats large counts with thousands separators', async () => {
    await update({ total: 12500, page: 120 });

    expect(info()).toBe('Showing 1,201 to 1,210 of 12,500');
  });

  it('marks only the current page as current, in the secondary style', async () => {
    await update({ page: 1 });

    const current = pageButtons().filter((button) => button.getAttribute('aria-current') === 'page');
    expect(current.map((button) => button.textContent?.trim())).toEqual(['2']);
    expect(current[0].className).toContain('border-ui-neutral-alpha-300');
    expect(pageButtons()[0].className).toContain('border-transparent');
  });

  it('keeps a window of five pages centred on the current page', async () => {
    await update({ total: 200, page: 9 });
    expect(labels()).toEqual(['8', '9', '10', '11', '12']);

    await update({ page: 19 });
    expect(labels()).toEqual(['16', '17', '18', '19', '20']);
  });

  it('shows fewer than five numbers when there are fewer pages', async () => {
    await update({ total: 25 });

    expect(labels()).toEqual(['1', '2', '3']);
  });

  it('disables previous on the first page and next on the last', async () => {
    expect(previous().disabled).toBe(true);
    expect(next().disabled).toBe(false);

    await update({ page: 4 });

    expect(previous().disabled).toBe(false);
    expect(next().disabled).toBe(true);
  });

  it('writes the chosen page back through [(page)]', async () => {
    pageButtons()[3].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.page()).toBe(3);

    next().click();
    await fixture.whenStable();
    expect(fixture.componentInstance.page()).toBe(4);

    previous().click();
    await fixture.whenStable();
    expect(fixture.componentInstance.page()).toBe(3);
  });

  it('renders nothing when every row fits on one page', async () => {
    await update({ total: 10 });
    expect(nav()).toBeNull();

    await update({ total: 0 });
    expect(nav()).toBeNull();
  });

  it('writes the page shown as current back when page is out of range', async () => {
    await update({ page: 9 });

    pageButtons()[4].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.page()).toBe(4);
  });

  it('moves focus to the current page when an arrow disables itself at the end of the range', async () => {
    await update({ page: 3 });
    next().focus();

    next().click();
    await fixture.whenStable();

    expect(next().disabled).toBe(true);
    expect(document.activeElement?.getAttribute('aria-current')).toBe('page');
    expect(document.activeElement?.textContent?.trim()).toBe('5');
  });

  it('keeps an out-of-range page on the last page that exists', async () => {
    await update({ page: 9 });

    expect(info()).toBe('Showing 41 to 42 of 42');
    expect(
      pageButtons()
        .find((button) => button.getAttribute('aria-current') === 'page')
        ?.textContent?.trim()
    ).toBe('5');
  });
});

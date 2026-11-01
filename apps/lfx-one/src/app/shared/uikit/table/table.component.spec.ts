// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ScrollDispatcher } from '@angular/cdk/scrolling';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiTableColumn, UiTableSort } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiTableCellDirective } from './table-cell.directive';
import { UiTableComponent } from './table.component';

const columns: UiTableColumn[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'project', header: 'Project', muted: true },
  { key: 'contributions', header: 'Contributions', align: 'end', sortable: true },
];

const rows = [
  { id: 1, name: 'Alex Example', project: 'Kubernetes', contributions: '1,204' },
  { id: 2, name: 'Sam Sample', project: 'Envoy', contributions: '318' },
  { id: 3, name: 'Jo Placeholder', project: 'OpenSSF', contributions: '57' },
];

@Component({
  selector: 'lfx-ui-table-test-host',
  imports: [UiTableComponent, UiTableCellDirective],
  template: `<!-- prettier-ignore --><lfx-ui-table label="T" [columns]="columns" [rows]="rows" rowKey="id" interactive (rowActivate)="activated.push($event)"><ng-template lfxUiTableCell="project" let-row let-column="column"><button type="button">{{ row.project }}/{{ column.key }}</button></ng-template><ng-template lfxUiTableCell="contributions" let-row><label>{{ row.contributions }}</label></ng-template></lfx-ui-table>`,
})
class HostComponent {
  public readonly columns = columns;
  public readonly rows = rows;
  public readonly activated: unknown[] = [];
}

// True when the CDK scroll dispatcher tracks the element, so overlays anchored inside it follow its scrolling.
const registered = (el: Element): boolean => [...TestBed.inject(ScrollDispatcher).scrollContainers.keys()].some((s) => s.getElementRef().nativeElement === el);

describe('UiTableComponent', () => {
  let fixture: ComponentFixture<UiTableComponent>;
  let host: HTMLElement;

  const setInputs = async (inputs: Record<string, unknown>): Promise<void> => {
    Object.entries(inputs).forEach(([key, value]) => fixture.componentRef.setInput(key, value));
    await fixture.whenStable();
  };
  const headers = (): HTMLElement[] => Array.from(host.querySelectorAll('[data-testid="ui-table-header"]'));
  const bodyRows = (): HTMLElement[] => Array.from(host.querySelectorAll('[data-testid="ui-table-row"]'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiTableComponent, HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiTableComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('label', 'Contributors');
    fixture.componentRef.setInput('columns', columns);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('rowKey', 'id');
    await fixture.whenStable();
  });

  it('is a real table named by a caption and a focusable region', () => {
    expect(host.querySelector('table')).not.toBeNull();
    expect(host.querySelector('caption')?.textContent?.trim()).toBe('Contributors');
    expect(host.getAttribute('role')).toBe('region');
    expect(host.getAttribute('aria-label')).toBe('Contributors');
    expect(host.tabIndex).toBe(0);
    expect(host.className).toContain('overflow-x-auto');
    // Registered with the CDK so overlays opened from a cell follow its scrolling.
    expect(registered(host)).toBe(true);
  });

  it('renders column headers with scope col, a 40px band and the label type', () => {
    expect(headers().map((th) => th.textContent?.trim())).toEqual(['Name', 'Project', 'Contributions']);
    headers().forEach((th) => expect(th.getAttribute('scope')).toBe('col'));
    expect(headers()[0].className).toContain('h-[40px]');
    expect(headers()[0].className).toContain('bg-ui-background-200');
    expect(headers()[0].className).toContain('label-13');
    expect(headers()[0].className).toContain('font-medium');
  });

  it('renders one 48px row per item with cell text', () => {
    expect(bodyRows().length).toBe(3);
    const cells = Array.from(bodyRows()[0].querySelectorAll('td'));
    expect(cells.map((td) => td.textContent?.trim())).toEqual(['Alex Example', 'Kubernetes', '1,204']);
    expect(cells[0].className).toContain('h-ui-row');
  });

  it('right-aligns end columns with tabular figures and mutes muted columns', () => {
    const cells = Array.from(bodyRows()[0].querySelectorAll('td'));
    expect(cells[2].className).toContain('text-right');
    expect(cells[2].className).toContain('tabular-nums');
    expect(headers()[2].className).toContain('text-right');
    expect(cells[1].className).toContain('text-ui-neutral-600');
    expect(cells[0].className).toContain('text-ui-neutral-900');
  });

  it('draws a divider under every body row except the last', () => {
    const lastCell = bodyRows()[2].querySelector('td') as HTMLElement;
    const firstCell = bodyRows()[0].querySelector('td') as HTMLElement;

    expect(firstCell.className).toContain('border-b');
    expect(firstCell.classList.contains('border-b-0')).toBe(false);
    expect(lastCell.classList.contains('border-b-0')).toBe(true);
  });

  it('shows the empty label in one full-width row when there are no rows', async () => {
    await setInputs({ rows: [], emptyLabel: 'No contributors yet' });

    const empty = host.querySelector('[data-testid="ui-table-empty"]') as HTMLElement;
    expect(bodyRows().length).toBe(0);
    expect(empty.textContent?.trim()).toBe('No contributors yet');
    expect(empty.getAttribute('colspan')).toBe('3');
  });

  it('renders a footer row from a value per column', async () => {
    await setInputs({ footer: { name: 'Total', contributions: '1,579' } });

    const cells = Array.from(host.querySelectorAll('tfoot [data-testid="ui-table-footer-cell"]'));
    expect(cells.map((td) => td.textContent?.trim())).toEqual(['Total', '', '1,579']);
    expect(cells[0].className).toContain('font-medium');
    expect(cells[0].className).toContain('bg-ui-background-200');
  });

  it('adds the ring and radius only when bordered', async () => {
    expect(host.className).not.toContain('shadow-border');

    await setInputs({ bordered: true });

    expect(host.className).toContain('shadow-border');
    expect(host.className).toContain('rounded-ui-sm');
  });

  it('tints even rows only when striped', async () => {
    expect(bodyRows()[1].className).not.toContain('even:bg-ui-background-200');

    await setInputs({ striped: true });

    expect(bodyRows()[1].className).toContain('even:bg-ui-background-200');
  });

  it('is not focusable or clickable per row unless interactive', async () => {
    let activated = 0;
    fixture.componentInstance.rowActivate.subscribe(() => activated++);

    bodyRows()[0].click();
    expect(bodyRows()[0].hasAttribute('tabindex')).toBe(false);
    expect(activated).toBe(0);
  });

  it('activates an interactive row on click, Enter and Space, but not for keys on an inner control', async () => {
    await setInputs({ interactive: true });
    const activated: unknown[] = [];
    fixture.componentInstance.rowActivate.subscribe((row) => activated.push(row));
    const row = bodyRows()[1];

    expect(row.tabIndex).toBe(0);
    expect(row.className).toContain('cursor-pointer');
    row.click();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    row.dispatchEvent(space);
    (row.querySelector('td') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(activated).toEqual([rows[1], rows[1], rows[1]]);
    expect(space.defaultPrevented).toBe(true);
  });

  it('marks only the sorted column with aria-sort and a matching icon', async () => {
    expect(headers().every((th) => !th.hasAttribute('aria-sort'))).toBe(true);

    await setInputs({ sort: { key: 'contributions', direction: 'desc' } satisfies UiTableSort });

    expect(headers()[0].hasAttribute('aria-sort')).toBe(false);
    expect(headers()[2].getAttribute('aria-sort')).toBe('descending');
    expect(headers()[2].querySelector('i')?.className).toContain('fa-arrow-down');

    await setInputs({ sort: { key: 'contributions', direction: 'asc' } satisfies UiTableSort });
    expect(headers()[2].getAttribute('aria-sort')).toBe('ascending');
  });

  it('turns only sortable headers into buttons', () => {
    expect(headers()[0].querySelector('button')).not.toBeNull();
    expect(headers()[1].querySelector('button')).toBeNull();
    expect(headers()[2].querySelector('button')?.getAttribute('type')).toBe('button');
  });

  it('sorts ascending first, then flips on the same column, and restarts ascending on another', async () => {
    const sortButton = (index: number): HTMLButtonElement => headers()[index].querySelector('button') as HTMLButtonElement;

    sortButton(0).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.sort()).toEqual({ key: 'name', direction: 'asc' });

    sortButton(0).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.sort()).toEqual({ key: 'name', direction: 'desc' });

    sortButton(2).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.sort()).toEqual({ key: 'contributions', direction: 'asc' });
  });

  it('does not activate an interactive row for a click on a control or label inside a cell template', async () => {
    const withTemplate = TestBed.createComponent(HostComponent);
    await withTemplate.whenStable();
    const el = withTemplate.nativeElement as HTMLElement;

    (el.querySelector('tbody button') as HTMLButtonElement).click();
    expect(withTemplate.componentInstance.activated).toEqual([]);

    (el.querySelector('tbody label') as HTMLLabelElement).click();
    expect(withTemplate.componentInstance.activated).toEqual([]);

    (el.querySelector('tbody td') as HTMLElement).click();
    expect(withTemplate.componentInstance.activated).toEqual([rows[0]]);
  });

  it('renders a projected cell template for its column with the row and column', async () => {
    const withTemplate = TestBed.createComponent(HostComponent);
    await withTemplate.whenStable();
    const cells = Array.from((withTemplate.nativeElement as HTMLElement).querySelectorAll('tbody button'));

    expect(cells.map((cell) => cell.textContent)).toEqual(['Kubernetes/project', 'Envoy/project', 'OpenSSF/project']);
  });
});

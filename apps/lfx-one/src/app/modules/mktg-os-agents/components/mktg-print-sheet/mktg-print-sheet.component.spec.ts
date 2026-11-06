// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_PRINT_PAGE_MARGINS_CLASS } from '@lfx-one/shared/constants';
import { expect, it } from 'vitest';
import { MktgPrintSheetComponent } from './mktg-print-sheet.component';
import { MktgPrintSheetRowComponent } from '../mktg-print-sheet-row/mktg-print-sheet-row.component';

@Component({
  selector: 'lfx-print-sheet-test-host',
  imports: [MktgPrintSheetComponent, MktgPrintSheetRowComponent],
  template: `<lfx-mktg-print-sheet>
    <lfx-mktg-print-sheet-row [flows]="flows()"><section style="display: grid" data-testid="block">Synthetic block</section></lfx-mktg-print-sheet-row>
  </lfx-mktg-print-sheet>`,
})
class HostComponent {
  public readonly flows = signal(false);
}

it('is a table whose head and foot repeat the page room on every page, with the projected rows as its body', async () => {
  const fixture = TestBed.createComponent(HostComponent);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const sheet = root.querySelector<HTMLElement>('lfx-mktg-print-sheet');
  const head = root.querySelector<HTMLElement>('[data-testid="mktg-print-sheet-head"]');
  const body = root.querySelector<HTMLElement>('[data-testid="mktg-print-sheet-body"]');
  const cell = root.querySelector<HTMLElement>('[data-testid="mktg-print-sheet-cell"]');
  if (!sheet || !head || !body || !cell) throw new Error('Missing synthetic print sheet');
  // A head group and the body: no footer group (Chromium prints an empty page per table for any repeating footer).
  expect(Array.from(sheet.children, (group) => group.getAttribute('data-testid'))).toEqual(['mktg-print-sheet-head', 'mktg-print-sheet-body']);
  expect(root.querySelector('[data-testid="mktg-print-sheet-foot"], tfoot')).toBeNull();
  expect(getComputedStyle(sheet).display).toBe('table');
  expect(getComputedStyle(head).display).toBe('table-header-group');
  expect(getComputedStyle(body).display).toBe('table-row-group');
  // 0.55in (52.8px at 96dpi, jsdom's computed value): the top room the portrait page margin used to give, repeated per
  // page by the head; the bottom room, once per sheet, is the last row's cell padding.
  const room = head.querySelector<HTMLElement>('.lfx-print-sheet-room');
  expect(room && getComputedStyle(room).display).toBe('table-row');
  expect(room && getComputedStyle(room).height).toBe('52.8px');
  expect(getComputedStyle(cell).paddingBottom).toBe('52.8px');
  // The body holds the rows and nothing else: a page breaks only between them.
  expect(Array.from(body.children, (row) => row.tagName.toLowerCase())).toEqual(['lfx-mktg-print-sheet-row']);
  // On the page margins (WebKit prints a table's head once) the margin is the room and the sheet gives none.
  document.body.classList.add(MKTG_PRINT_PAGE_MARGINS_CLASS);
  try {
    expect(room && getComputedStyle(room).height).toBe('0px');
    expect(getComputedStyle(cell).paddingBottom).toBe('0px');
  } finally {
    document.body.classList.remove(MKTG_PRINT_PAGE_MARGINS_CLASS);
  }
});

it('keeps each row whole across a page break unless the caller lets it flow, and leaves the block its own layout', async () => {
  const fixture = TestBed.createComponent(HostComponent);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const row = root.querySelector<HTMLElement>('lfx-mktg-print-sheet-row');
  const cell = root.querySelector<HTMLElement>('[data-testid="mktg-print-sheet-cell"]');
  const block = root.querySelector<HTMLElement>('[data-testid="block"]');
  if (!row || !cell || !block) throw new Error('Missing synthetic print sheet row');
  expect(getComputedStyle(row).display).toBe('table-row');
  expect(getComputedStyle(row).breakInside).toBe('avoid');
  expect(getComputedStyle(cell).display).toBe('table-cell');
  expect(block.parentElement).toBe(cell);
  // The block keeps its own display inside the cell: nothing turns it into a row.
  expect(getComputedStyle(block).display).toBe('grid');
  fixture.componentInstance.flows.set(true);
  await fixture.whenStable();
  expect(row.classList.contains('lfx-print-sheet-row-flows')).toBe(true);
  expect(getComputedStyle(row).breakInside).toBe('auto');
});

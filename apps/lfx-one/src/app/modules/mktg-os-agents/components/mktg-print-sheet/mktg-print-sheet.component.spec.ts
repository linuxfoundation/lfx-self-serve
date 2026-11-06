// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expect, it } from 'vitest';
import { MktgPrintSheetComponent } from './mktg-print-sheet.component';
import { MktgPrintSheetRowComponent } from '../mktg-print-sheet-row/mktg-print-sheet-row.component';

@Component({
  imports: [MktgPrintSheetComponent, MktgPrintSheetRowComponent],
  template: `
    <lfx-mktg-print-sheet>
      <lfx-mktg-print-sheet-row><section data-testid="first">Synthetic first block</section></lfx-mktg-print-sheet-row>
      <lfx-mktg-print-sheet-row [flows]="true"><div class="grid grid-cols-2" data-testid="second">Synthetic long block</div></lfx-mktg-print-sheet-row>
    </lfx-mktg-print-sheet>
  `,
})
class HostComponent {}

it('is a table whose head and foot repeat the page room on every page, with one row per projected block', async () => {
  const fixture = TestBed.createComponent(HostComponent);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const sheet = root.querySelector<HTMLElement>('lfx-mktg-print-sheet');
  const head = root.querySelector<HTMLElement>('[data-testid="mktg-print-sheet-head"]');
  const body = root.querySelector<HTMLElement>('[data-testid="mktg-print-sheet-body"]');
  const foot = root.querySelector<HTMLElement>('[data-testid="mktg-print-sheet-foot"]');
  if (!sheet || !head || !body || !foot) throw new Error('Missing synthetic print sheet');
  expect(Array.from(sheet.children, (group) => group.getAttribute('data-testid'))).toEqual([
    'mktg-print-sheet-head',
    'mktg-print-sheet-body',
    'mktg-print-sheet-foot',
  ]);
  expect(getComputedStyle(sheet).display).toBe('table');
  expect(getComputedStyle(head).display).toBe('table-header-group');
  expect(getComputedStyle(body).display).toBe('table-row-group');
  expect(getComputedStyle(foot).display).toBe('table-footer-group');
  // 0.55in each (52.8px at 96dpi): the room the portrait page margin used to give.
  expect(Math.round(head.getBoundingClientRect().height)).toBe(53);
  expect(Math.round(foot.getBoundingClientRect().height)).toBe(53);
  // The body holds the rows and nothing else: a page breaks only between them.
  const rows = Array.from(body.children);
  expect(rows.map((row) => row.tagName.toLowerCase())).toEqual(['lfx-mktg-print-sheet-row', 'lfx-mktg-print-sheet-row']);
  expect(rows.map((row) => getComputedStyle(row).display)).toEqual(['table-row', 'table-row']);
  expect(rows.map((row) => getComputedStyle(row).breakInside)).toEqual(['avoid', 'auto']);
  const cells = rows.map((row) => row.querySelector<HTMLElement>('[data-testid="mktg-print-sheet-cell"]'));
  expect(cells.map((cell) => (cell ? getComputedStyle(cell).display : null))).toEqual(['table-cell', 'table-cell']);
  // The projected block keeps its own layout inside the row's cell.
  expect(root.querySelector('[data-testid="mktg-print-sheet-cell"] > [data-testid="first"]')?.textContent).toBe('Synthetic first block');
  const second = root.querySelector<HTMLElement>('[data-testid="second"]');
  expect(second && getComputedStyle(second).display).toBe('grid');
});

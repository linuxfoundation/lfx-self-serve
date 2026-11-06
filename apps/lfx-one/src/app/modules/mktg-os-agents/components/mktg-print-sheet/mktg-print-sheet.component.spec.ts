// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expect, it } from 'vitest';
import { MktgPrintSheetComponent } from './mktg-print-sheet.component';
import { MktgPrintSheetRowComponent } from '../mktg-print-sheet-row/mktg-print-sheet-row.component';

@Component({
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
  // 0.55in each, the room the portrait page margin used to give: the declared value, as jsdom lays nothing out.
  const rooms = [head, foot].map((group) => group.querySelector<HTMLElement>('.lfx-print-sheet-room'));
  expect(rooms.map((room) => room && getComputedStyle(room).display)).toEqual(['table-row', 'table-row']);
  expect(rooms.map((room) => room && getComputedStyle(room).height)).toEqual(['0.55in', '0.55in']);
  // The body holds the rows and nothing else: a page breaks only between them.
  expect(Array.from(body.children, (row) => row.tagName.toLowerCase())).toEqual(['lfx-mktg-print-sheet-row']);
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

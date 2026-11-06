// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expect, it } from 'vitest';
import { MktgPrintSheetComponent } from './mktg-print-sheet.component';

@Component({
  imports: [MktgPrintSheetComponent],
  template: `<lfx-mktg-print-sheet><section data-testid="body">Synthetic section</section></lfx-mktg-print-sheet>`,
})
class HostComponent {}

it('repeats the page room above and below the projected section on every page', async () => {
  const fixture = TestBed.createComponent(HostComponent);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const sheet = root.querySelector<HTMLTableElement>('[data-testid="mktg-print-sheet"]');
  if (!sheet) throw new Error('Missing synthetic print sheet');
  expect(sheet.tagName).toBe('TABLE');
  expect(Array.from(sheet.children, (group) => group.tagName)).toEqual(['THEAD', 'TBODY', 'TFOOT']);
  expect(sheet.querySelector('tbody > tr > td > [data-testid="body"]')?.textContent).toBe('Synthetic section');
  const head = sheet.querySelector('thead');
  const foot = sheet.querySelector('tfoot');
  if (!head || !foot) throw new Error('Missing synthetic sheet groups');
  expect(getComputedStyle(head).display).toBe('table-header-group');
  expect(getComputedStyle(foot).display).toBe('table-footer-group');
  // 0.55in at 96dpi: the room the portrait page margin used to give.
  expect(Math.round(head.getBoundingClientRect().height)).toBe(53);
  expect(Math.round(foot.getBoundingClientRect().height)).toBe(53);
  expect(getComputedStyle(sheet).breakInside).toBe('auto');
});

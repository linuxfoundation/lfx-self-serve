// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import {
  MKTG_PRINT_LANDSCAPE_CLASS,
  MKTG_PRINT_PAGE_AREA,
  MKTG_PRINT_PAGE_LEFT,
  MKTG_PRINT_PAGE_LOGO_FRAME,
  MKTG_PRINT_PAGE_RIGHT,
  MKTG_PRINT_PAGE_SCALE,
  MKTG_PRINT_PAGE_TITLE_BOX,
} from '@lfx-one/shared/constants';
import { MktgPrintPage, MktgPrintPageLook } from '@lfx-one/shared/interfaces';
import {
  mktgPagePt,
  mktgPrintBrand,
  mktgPrintContentPage,
  mktgPrintCoverPage,
  mktgPrintEyebrowPara,
  mktgPrintFooterLine,
  mktgPrintPageLook,
  mktgPrintPara,
  mktgPrintProseColumn,
  mktgPrintProseParas,
  mktgPrintRich,
  mktgPrintShapeEl,
  mktgPrintTextEl,
  mktgPrintWithFooter,
} from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgPrintPageComponent } from './mktg-print-page.component';
import { MktgPrintPageSlotDirective } from './mktg-print-page-slot.directive';

const PROJECT = 'Synthetic Project';
const brand = mktgPrintBrand(null);
const look: MktgPrintPageLook = mktgPrintPageLook(brand);

/** The sample cover: the deck's cover form (eyebrow line, title, subtitle, footer line) on the dark ground. */
function sampleCover(): MktgPrintPage {
  const onDark = (text: string, size: number, align: 'START' | 'END' = 'START') =>
    mktgPrintRich(look, [mktgPrintPara(text, size, { caps: size === 8 && align === 'START' })], { color: look.onDark, align });
  return mktgPrintCoverPage(look, 'Brand Kit', 'Logos, color, type and usage on one reference, for members, partners and the press.', [
    mktgPrintTextEl({ x: 38, y: 12, w: 470, h: 26 }, onDark(`${PROJECT} · A Linux Foundation project`, 8)),
    mktgPrintTextEl({ x: 38, y: 362, w: 330, h: 26 }, onDark(mktgPrintFooterLine(PROJECT), 8)),
    mktgPrintTextEl({ x: 368, y: 362, w: 294, h: 26 }, onDark('V1.0 · November 2026', 8, 'END')),
  ]);
}

/** The sample content page: the book's 30% prose column, a visual box beside it in the tint, and a slot the document fills. */
function sampleContent(): MktgPrintPage {
  const column = mktgPrintProseColumn(look, [
    mktgPrintEyebrowPara(look, 'The lockup'),
    ...mktgPrintProseParas(['The primary lockup sets the symbol beside the wordmark.', 'Use it on white or on the dark; keep the clear space.']),
  ]);
  const visual = mktgPrintShapeEl('ROUND_RECTANGLE', MKTG_PRINT_PAGE_RIGHT, look.tint);
  const slot = { t: 'slot' as const, box: { x: MKTG_PRINT_PAGE_RIGHT.x + 20, y: MKTG_PRINT_PAGE_RIGHT.y + 20, w: 200, h: 60 }, slot: 'sample-visual' };
  const page = mktgPrintContentPage(look, 'Logo system', { left: '01 Logo', right: `${PROJECT} Brand Kit` }, [column, visual, slot]);
  return mktgPrintWithFooter(page, mktgPrintFooterLine(PROJECT), 3);
}

@Component({
  selector: 'lfx-mktg-print-page-host',
  imports: [MktgPrintPageComponent, MktgPrintPageSlotDirective],
  templateUrl: './mktg-print-page.test-host.html',
})
class HostComponent {
  public page = sampleContent();
  public look = look;
  public logo = brand.logoOnLight;
}

const pt = mktgPagePt;

describe('MktgPrintPageComponent', () => {
  it('draws a content page as one fixed landscape frame: title band, eyebrow head left and right, body boxes in pt, logo lockup and footer with page number', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const page = root.querySelector<HTMLElement>('[data-testid="mktg-print-page"]');
    expect(page?.getAttribute('data-layout')).toBe('content');
    expect(page?.getAttribute('data-title')).toBe('Logo system');
    expect(page?.classList.contains('lfx-print-page--dark')).toBe(false);
    expect(page?.style.getPropertyValue('--pp-font')).toBe(brand.fontStack);
    expect(page?.style.getPropertyValue('--pp-dark')).toBe(brand.dark);
    const host = root.querySelector<HTMLElement>('lfx-mktg-print-page');
    expect(host?.classList.contains(MKTG_PRINT_LANDSCAPE_CLASS)).toBe(true);
    expect(host?.style.getPropertyValue('--mktg-page-scale')).toBe(String(MKTG_PRINT_PAGE_SCALE));
    const area = root.querySelector<HTMLElement>('[data-testid="mktg-print-page-area"]');
    expect(area?.style.left).toBe(pt(MKTG_PRINT_PAGE_AREA.x));
    expect(area?.style.height).toBe(pt(MKTG_PRINT_PAGE_AREA.h));
    expect(area?.querySelector('[data-testid="projected"]')?.textContent).toBe('Projected content');

    const title = root.querySelector<HTMLElement>('[data-testid="mktg-print-page-title"]');
    expect(title?.textContent?.trim()).toBe('Logo system');
    expect(title?.style.left).toBe(pt(MKTG_PRINT_PAGE_TITLE_BOX.x));
    expect(title?.style.width).toBe(pt(MKTG_PRINT_PAGE_TITLE_BOX.w));

    const heads = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-head"]');
    expect(heads).toHaveLength(2);
    expect(heads[0].textContent?.trim()).toBe('01 Logo');
    expect(heads[0].querySelector('.pp-para--caps')).not.toBeNull();
    expect(heads[1].textContent?.trim()).toBe(`${PROJECT} Brand Kit`);
    expect(heads[1].querySelector('.pp-rich--end')).not.toBeNull();

    const footers = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-footer"]');
    expect(footers).toHaveLength(2);
    expect(footers[0].textContent?.trim()).toBe(`${PROJECT} · a Linux Foundation project`);
    expect(footers[1].textContent?.trim()).toBe('03');

    const logo = root.querySelector<HTMLElement>('[data-testid="mktg-print-page-logo"]');
    expect(logo?.style.left).toBe(pt(MKTG_PRINT_PAGE_LOGO_FRAME.x));
    expect(logo?.style.top).toBe(pt(MKTG_PRINT_PAGE_LOGO_FRAME.y));
    expect(logo?.querySelector('img')?.getAttribute('src')).toBe(brand.logoOnLight?.src);

    const els = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]');
    expect(els).toHaveLength(3);
    expect(els[0].style.left).toBe(pt(MKTG_PRINT_PAGE_LEFT.x));
    expect(els[0].style.height).toBe(pt(MKTG_PRINT_PAGE_LEFT.h));
    expect(els[0].textContent).toContain('The primary lockup sets the symbol beside the wordmark.');
    expect(els[0].querySelectorAll('p')[1].style.fontSize).toBe(pt(11));
    expect(els[0].querySelectorAll('p')[1].style.marginTop).toBe(pt(11 * 0.7));
    expect(els[1].style.backgroundColor).not.toBe('');
    expect(els[1].classList.contains('pp-shape--round')).toBe(true);
    expect(els[2].getAttribute('data-slot')).toBe('sample-visual');
    expect(els[2].querySelector('[data-testid="sample-visual"]')?.textContent).toBe('Visual markup');
  });

  it('draws the cover on the dark ground with its title and subtitle fitted, and no head, footer or logo frame', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.page = sampleCover();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const page = root.querySelector<HTMLElement>('[data-testid="mktg-print-page"]');
    expect(page?.getAttribute('data-layout')).toBe('cover');
    expect(page?.classList.contains('lfx-print-page--dark')).toBe(true);
    expect(root.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Brand Kit');
    expect(root.querySelector('[data-testid="mktg-print-page-subtitle"]')?.textContent).toContain('Logos, color, type and usage on one reference');
    expect(root.querySelector('[data-testid="mktg-print-page-head"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-print-page-footer"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-print-page-logo"]')).toBeNull();
    const els = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]');
    expect(els).toHaveLength(3);
    expect(els[0].textContent?.trim()).toBe(`${PROJECT} · A Linux Foundation project`);
    expect(els[2].textContent?.trim()).toBe('V1.0 · November 2026');
  });

  it('makes a content page from the plain inputs alone: eyebrows, title, footer line and the number the builder gave', async () => {
    const fixture = TestBed.createComponent(MktgPrintPageComponent);
    fixture.componentRef.setInput('look', look);
    fixture.componentRef.setInput('eyebrowLeft', '02 Framework');
    fixture.componentRef.setInput('eyebrowRight', `${PROJECT} Messaging Framework`);
    fixture.componentRef.setInput('title', 'Goal columns (2)');
    fixture.componentRef.setInput('number', '07');
    fixture.componentRef.setInput('footerLine', mktgPrintFooterLine(PROJECT));
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-layout')).toBe('content');
    expect(root.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Goal columns (2)');
    const heads = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-head"]');
    expect(Array.from(heads, (head) => head.textContent?.trim())).toEqual(['02 Framework', `${PROJECT} Messaging Framework`]);
    const footers = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-footer"]');
    expect(Array.from(footers, (footer) => footer.textContent?.trim())).toEqual([`${PROJECT} · a Linux Foundation project`, '07']);
    expect(root.querySelector('[data-testid="mktg-print-page-logo"]')).toBeNull();
    expect(root.querySelectorAll('[data-testid="mktg-print-page-el"]')).toHaveLength(0);
  });
});

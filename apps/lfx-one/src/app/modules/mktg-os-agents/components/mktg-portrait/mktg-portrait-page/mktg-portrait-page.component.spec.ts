// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { MktgPortraitBook, MktgPortraitLook } from '@lfx-one/shared/interfaces';
import { mktgPortraitLook, mktgPrintBrand, mktgPortraitAccentText } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgPortraitPageComponent } from './mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../mktg-portrait-rect.directive';

const LOOK: MktgPortraitLook = mktgPortraitLook({ ...mktgPrintBrand(null), dark: '#000000', accent: '#FF702D' }, '#B6B0D0');
const BOOK: MktgPortraitBook = {
  inFamily: false,
  headRight: 'Synthetic project brand kit',
  footLeft: 'Synthetic project · a Linux Foundation project',
  firstPage: 1,
};

/** The host's template, projected into the frame as a document's page does. */
const HOST_TEMPLATE = `
  <lfx-mktg-portrait-page [look]="look" [book]="book()" pageId="logo-system" [page]="3" section="01 Logo" title="Logo system" [band]="band()" [dark]="dark()" [bare]="bare()">
    <p class="pp-body pp-body--wide" [lfxPpRect]="[56, 136, 704]" data-testid="synthetic-intro">Synthetic intro</p>
    <div [lfxPpRect]="[56, 232, 704, 240]" data-testid="synthetic-tile"></div>
  </lfx-mktg-portrait-page>
`;

@Component({ selector: 'lfx-test-portrait-page-host', template: '' })
class HostComponent {
  public readonly look = LOOK;
  public readonly book = signal(BOOK);
  public readonly band = signal(false);
  public readonly dark = signal(false);
  public readonly bare = signal(false);
}

async function setup() {
  // Set here because an inline template this long trips component-max-inline-declarations.
  TestBed.overrideComponent(HostComponent, { set: { imports: [MktgPortraitPageComponent, MktgPortraitRectDirective], template: HOST_TEMPLATE } });
  const fixture = TestBed.createComponent(HostComponent);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const page = root.querySelector<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]');
  if (!page) throw new Error('Missing synthetic page');
  return { fixture, root, page, host: fixture.componentInstance };
}

describe('lfx-mktg-portrait-page', () => {
  it('is one fixed US Letter frame, named for QA, in the document’s look', async () => {
    const { page } = await setup();
    expect(page.classList.contains('pp-page')).toBe(true);
    expect(page.getAttribute('data-page-id')).toBe('logo-system');
    expect(page.getAttribute('data-page')).toBe('3');
    expect(page.getAttribute('data-section')).toBe('01 Logo');
    // A block host (MKTG_PORTRAIT_BLOCK_HOST): Chrome 156 breaks a sheet at the anonymous-block boundary an inline host puts around a frame.
    expect(getComputedStyle(page).display).toBe('block');
    expect(page.style.getPropertyValue('--pp-dark')).toBe('#000000');
    expect(page.style.getPropertyValue('--pp-accent')).toBe('#FF702D');
    // The accent as text: the coral darkened until it reads on white at WCAG AA (the shared util's value).
    expect(page.style.getPropertyValue('--pp-accent-text')).toBe(mktgPortraitAccentText('#FF702D'));
    expect(page.style.getPropertyValue('--pp-accent-text')).not.toBe('#FF702D');
    expect(page.style.getPropertyValue('--pp-spark')).toBe('#B6B0D0');
    expect(page.style.getPropertyValue('--pp-on-accent')).toBe('#000000');
    expect(page.style.getPropertyValue('--pp-font')).toBe(LOOK.fontStack);
    // The grid ground's glow and grid: the accent with its alpha.
    expect(page.style.getPropertyValue('--pp-glow')).toBe('#FF702D55');
    // The print's glow is the stronger one (on paper the screen's is almost invisible), the same accent.
    expect(page.style.getPropertyValue('--pp-glow-print')).toBe('#FF702D88');
    expect(page.style.getPropertyValue('--pp-grid')).toBe('#FF702D22');
    expect(MKTG_PORTRAIT_PAGE).toMatchObject({ width: 816, height: 1056 });
  });

  it('draws the running head, the title and the footer with the two-digit page number, and no band off a chapter start', async () => {
    const { page } = await setup();
    expect(page.querySelector('[data-testid="mktg-portrait-page-section"]')?.textContent).toBe('01 Logo');
    expect(page.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent).toBe('Synthetic project brand kit');
    expect(page.querySelector('[data-testid="mktg-portrait-page-title"]')?.textContent).toBe('Logo system');
    expect(page.querySelector('[data-testid="mktg-portrait-page-foot"]')?.textContent).toContain('Synthetic project · a Linux Foundation project');
    expect(page.querySelector('[data-testid="mktg-portrait-page-number"]')?.textContent).toBe('03');
    expect(page.querySelector('[data-testid="mktg-portrait-page-band"]')).toBeNull();
    expect(page.querySelector('.pp-head')?.classList.contains('pp-head--band')).toBe(false);
  });

  it('carries the 4 px accent band when the document says so (a chapter’s first page), and prints the family’s book texts', async () => {
    const { fixture, page, host } = await setup();
    host.band.set(true);
    await fixture.whenStable();
    expect(page.querySelector('[data-testid="mktg-portrait-page-band"]')).not.toBeNull();
    expect(page.querySelector('.pp-head')?.classList.contains('pp-head--band')).toBe(true);
    host.book.set({ inFamily: true, headRight: 'Synthetic project positioning & brand', footLeft: 'Synthetic family', firstPage: 17 });
    await fixture.whenStable();
    expect(page.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent).toBe('Synthetic project positioning & brand');
    expect(page.querySelector('[data-testid="mktg-portrait-page-foot"]')?.textContent).toContain('Synthetic family');
  });

  it('projects the page’s content placed by R(x, y, w, h): absolute, at its measurements, 0 height left to the content', async () => {
    const { page } = await setup();
    const intro = page.querySelector<HTMLElement>('[data-testid="synthetic-intro"]');
    const tile = page.querySelector<HTMLElement>('[data-testid="synthetic-tile"]');
    if (!intro || !tile) throw new Error('Missing synthetic blocks');
    expect(intro.classList.contains('pp-r')).toBe(true);
    expect(intro.style.left).toBe('56px');
    expect(intro.style.top).toBe('136px');
    expect(intro.style.width).toBe('704px');
    expect(intro.style.height).toBe('');
    expect(tile.style.height).toBe('240px');
    // The head and title come before the content, the footer after it.
    const order = Array.from(page.children).map((child) => child.getAttribute('data-testid'));
    expect(order.indexOf('mktg-portrait-page-head')).toBeLessThan(order.indexOf('synthetic-intro'));
    expect(order.indexOf('synthetic-tile')).toBeLessThan(order.indexOf('mktg-portrait-page-foot'));
  });

  it('bare and dark: no head, title or footer, the dark class on the frame (covers, openers, back covers)', async () => {
    const { fixture, page, host } = await setup();
    host.bare.set(true);
    host.dark.set(true);
    host.band.set(true);
    await fixture.whenStable();
    expect(page.classList.contains('pp-page--dark')).toBe(true);
    expect(page.querySelector('[data-testid="mktg-portrait-page-head"]')).toBeNull();
    expect(page.querySelector('[data-testid="mktg-portrait-page-title"]')).toBeNull();
    expect(page.querySelector('[data-testid="mktg-portrait-page-foot"]')).toBeNull();
    expect(page.querySelector('[data-testid="mktg-portrait-page-band"]')).toBeNull();
    expect(page.querySelector('[data-testid="synthetic-intro"]')).not.toBeNull();
  });

  it('leaves a non-hex accent as it is for the grid ground', async () => {
    const fixture = TestBed.createComponent(MktgPortraitPageComponent);
    fixture.componentRef.setInput('look', { ...LOOK, accent: 'rebeccapurple' });
    fixture.componentRef.setInput('book', BOOK);
    fixture.componentRef.setInput('pageId', 'cover');
    fixture.componentRef.setInput('page', 1);
    await fixture.whenStable();
    const page: HTMLElement = fixture.nativeElement;
    expect(page.style.getPropertyValue('--pp-glow')).toBe('rebeccapurple');
    expect(page.style.getPropertyValue('--pp-glow-print')).toBe('rebeccapurple');
    expect(page.getAttribute('data-testid')).toBe('lfx-mktg-portrait-page');
  });
});

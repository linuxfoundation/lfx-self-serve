// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageContentsComponent } from './mktg-brand-kit-page-contents.component';
import { mountBrandKitPage, rectOf, wordsOf } from './mktg-brand-kit-page.spec-helper';

async function setup(approval: { approvedAt: string; approvedBy: { name: string } | null } | null = null) {
  const mounted = await mountBrandKitPage(MktgBrandKitPageContentsComponent, 'contents');
  mounted.fixture.componentRef.setInput('approval', approval);
  await mounted.fixture.whenStable();
  return mounted;
}

describe('the contents page', () => {
  it('lists every content page after it with its number from the plan, once, and not the back cover', async () => {
    const { frame, pages } = await setup();
    expect(frame.getAttribute('data-page')).toBe('2');
    expect(frame.getAttribute('data-page-id')).toBe('contents');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-title"]')?.textContent).toBe("What's inside");
    const rows = Array.from(frame.querySelectorAll('.kp-contents-row'));
    // The editor's ruling: the number once (right column), no left index, and the back cover is not a content page.
    expect(rows).toHaveLength(13);
    expect(wordsOf(rows[0])).toBe('Logo system 3');
    expect(wordsOf(rows[12])).toBe('Sources & decisions 15');
    expect(frame.textContent).not.toContain('Back cover');
    expect(rows.map((row) => row.getAttribute('data-page-ref'))).toEqual(pages.slice(2, -1).map((page) => page.id));
    expect(pages[pages.length - 1].id).toBe('back-cover');
    expect(rectOf(rows[0])).toEqual({ left: '56px', top: '148px', width: '704px' });
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).toBeNull();
  });

  it('says what the kit is built from without a file name, points at the Sources page, and shows the kit at a glance', async () => {
    const { frame, view } = await setup();
    const built = frame.querySelector('[data-testid="brand-kit-contents-built-from"]');
    expect(built?.textContent).toContain('Built from the uploaded logo files');
    expect(built?.textContent).not.toContain('logo.svg');
    expect(built?.parentElement?.textContent).toContain('is on page 15.');
    expect(rectOf(built)).toEqual({ left: '56px', top: '690px', width: '340px' });
    const glance = frame.querySelector<HTMLElement>('[data-testid="brand-kit-contents-glance"]');
    expect(rectOf(glance)).toEqual({ left: '420px', top: '690px', width: '340px' });
    // The card is as tall as its content: no fixed height on it or its placed box (the editor saw ~90 px of empty foot).
    expect(glance?.style.height).toBe('');
    expect(glance?.closest<HTMLElement>('.pp-r')?.style.height).toBe('');
    expect(glance?.querySelector('[data-testid="brand-kit-artwork-lockup"]')?.getAttribute('src')).toBe(view.logos.primary?.src);
    expect(glance?.querySelectorAll('.kp-glance-dot')).toHaveLength(view.palette.length);
    expect(glance?.querySelector('.kp-glance-family')?.textContent).toContain('Montserrat');
    expect(glance?.querySelector('.kp-glance-weights')?.textContent).toBe('· weights 400, 700');
    // The version prints on the cover and the back cover only, never in the glance.
    expect(glance?.querySelector('[data-testid="brand-kit-contents-version"]')).toBeNull();
    expect(glance?.textContent).not.toContain('V4.0');
    expect(frame.querySelector('[data-testid="brand-kit-contents-approval"]')).toBeNull();
    expect(frame.textContent).not.toContain('[');
  });

  it('moves the two lower blocks down for sixteen rows and lists seventeen in two columns, the type never smaller', async () => {
    const sixteen = await setup();
    // Extra content pages after the thirteen listed (the back cover is never a row).
    const extra = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...sixteen.pages[sixteen.pages.length - 1],
        id: `extra-${index}`,
        title: `Extra ${index + 1}`,
        number: 17 + index,
      }));
    sixteen.fixture.componentRef.setInput('pages', [...sixteen.pages, ...extra(3)]);
    await sixteen.fixture.whenStable();
    const list = sixteen.frame.querySelector('[data-testid="brand-kit-contents-list"]');
    expect(list?.querySelectorAll('.kp-contents-row')).toHaveLength(16);
    expect(list?.classList.contains('kp-contents-list--columns')).toBe(false);
    expect(rectOf(sixteen.frame.querySelector('[data-testid="brand-kit-contents-built-from"]'))).toEqual({ left: '56px', top: '716px', width: '340px' });
    expect(rectOf(sixteen.frame.querySelector('[data-testid="brand-kit-contents-glance"]'))).toEqual({ left: '420px', top: '716px', width: '340px' });

    sixteen.fixture.componentRef.setInput('pages', [...sixteen.pages, ...extra(4)]);
    await sixteen.fixture.whenStable();
    expect(list?.querySelectorAll('.kp-contents-row')).toHaveLength(17);
    expect(list?.classList.contains('kp-contents-list--columns')).toBe(true);
    expect(rectOf(sixteen.frame.querySelector('[data-testid="brand-kit-contents-built-from"]'))).toEqual({ left: '56px', top: '690px', width: '340px' });
  });

  it('prints the approval line only from a recorded approval, with the approver when the store names one', async () => {
    const { frame } = await setup({ approvedAt: '2026-11-06T10:00:00Z', approvedBy: { name: 'Synthetic Approver' } });
    expect(frame.querySelector('[data-testid="brand-kit-contents-approval"]')?.textContent).toBe('Approved 6 Nov 2026 by Synthetic Approver');
    const { frame: unnamed } = await setup({ approvedAt: '2026-11-06T10:00:00Z', approvedBy: null });
    expect(unnamed.querySelector('[data-testid="brand-kit-contents-approval"]')?.textContent).toBe('Approved 6 Nov 2026');
  });
});

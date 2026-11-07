// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageContentsComponent } from './mktg-brand-kit-page-contents.component';
import { mountBrandKitPage, rectOf } from './mktg-brand-kit-page.spec-helper';

async function setup(approval: { approvedAt: string; approvedBy: { name: string } | null } | null = null) {
  const mounted = await mountBrandKitPage(MktgBrandKitPageContentsComponent, 'contents');
  mounted.fixture.componentRef.setInput('pages', mounted.pages);
  mounted.fixture.componentRef.setInput('approval', approval);
  await mounted.fixture.whenStable();
  return mounted;
}

describe('the contents page', () => {
  it('lists every page after it with its number from the plan, so the count is the contents’ numbers', async () => {
    const { frame, pages } = await setup();
    expect(frame.getAttribute('data-page')).toBe('2');
    expect(frame.getAttribute('data-page-id')).toBe('contents');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-title"]')?.textContent).toBe("What's inside");
    const rows = Array.from(frame.querySelectorAll('.kp-contents-row'));
    expect(rows).toHaveLength(14);
    expect(rows[0].textContent?.replace(/\s+/g, ' ').trim()).toBe('03Logo system 3');
    expect(rows[13].textContent?.replace(/\s+/g, ' ').trim()).toBe('16Back cover 16');
    expect(rows.map((row) => row.getAttribute('data-page-ref'))).toEqual(pages.slice(2).map((page) => page.id));
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
    expect(glance?.querySelector('[data-testid="brand-kit-artwork-lockup"]')?.getAttribute('src')).toBe(view.logos.primary?.src);
    expect(glance?.querySelectorAll('.kp-glance-dot')).toHaveLength(view.palette.length);
    expect(glance?.querySelector('.kp-glance-family')?.textContent).toContain('Montserrat');
    expect(glance?.querySelector('.kp-glance-weights')?.textContent).toBe('· weights 400, 700');
    expect(glance?.querySelector('[data-testid="brand-kit-contents-version"]')?.textContent).toContain('Version V4.0 · October 2026');
    expect(frame.querySelector('[data-testid="brand-kit-contents-approval"]')).toBeNull();
    expect(frame.textContent).not.toContain('[');
  });

  it('prints the approval line only from a recorded approval, with the approver when the store names one', async () => {
    const { frame } = await setup({ approvedAt: '2026-11-06T10:00:00Z', approvedBy: { name: 'Synthetic Approver' } });
    expect(frame.querySelector('[data-testid="brand-kit-contents-approval"]')?.textContent).toBe('Approved 6 Nov 2026 by Synthetic Approver');
    const { frame: unnamed } = await setup({ approvedAt: '2026-11-06T10:00:00Z', approvedBy: null });
    expect(unnamed.querySelector('[data-testid="brand-kit-contents-approval"]')?.textContent).toBe('Approved 6 Nov 2026');
  });
});

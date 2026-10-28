// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LinkedinOption } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinPostOptionsComponent } from './linkedin-post-options.component';

const options: LinkedinOption[] = [1, 2, 3].map((number) => ({
  number,
  label: `Angle ${number}`,
  text: `Example post ${number}. [LINK] Again [LINK]`,
  word_count: 7,
  hashtags: ['#Code', '#Release', '#Community'],
  tagging_suggestions: ['Example project'],
}));
describe('Shared LinkedIn option cards', () => {
  const clipboard = vi.fn();
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  beforeEach(async () => {
    clipboard.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
    await TestBed.configureTestingModule({
      imports: [LinkedinPostOptionsComponent],
      providers: [provideRouter([]), provideNoopAnimations()],
    }).compileComponents();
  });
  afterEach(() => {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });
  async function render(shareLink = '') {
    const fixture = TestBed.createComponent(LinkedinPostOptionsComponent);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('shareLink', shareLink);
    fixture.componentRef.setInput('notes', ['Verify handles.']);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  it('selects the first option by default and moves the only solid Copy post with the pick or a direct copy', async () => {
    const fixture = await render('https://public.example/release');
    const selected = (number: number) => fixture.nativeElement.querySelector(`[data-testid="mktg-linkedin-select-${number}"]`);
    const copy = (number: number) => fixture.nativeElement.querySelector(`[data-testid="mktg-linkedin-copy-${number}"] button`);
    expect(selected(1).getAttribute('aria-pressed')).toBe('true');
    expect(selected(1).textContent).toContain('Selected');
    expect(selected(1).closest('article').classList.contains('border-blue-500')).toBe(true);
    expect(copy(1).classList.contains('p-button-outlined')).toBe(false);
    expect(copy(2).classList.contains('p-button-outlined')).toBe(true);
    selected(2).click();
    await fixture.whenStable();
    expect(selected(1).getAttribute('aria-pressed')).toBe('false');
    expect(selected(2).getAttribute('aria-pressed')).toBe('true');
    expect(copy(1).classList.contains('p-button-outlined')).toBe(true);
    expect(copy(2).classList.contains('p-button-outlined')).toBe(false);
    expect(clipboard).not.toHaveBeenCalled();
    copy(3).click();
    await fixture.whenStable();
    expect(selected(3).getAttribute('aria-pressed')).toBe('true');
    expect(copy(2).classList.contains('p-button-outlined')).toBe(true);
    expect(copy(3).classList.contains('p-button-outlined')).toBe(false);
    expect(clipboard).toHaveBeenCalledOnce();
    expect(clipboard.mock.calls[0][0]).toContain('Example post 3.');
    fixture.componentRef.setInput('shareLink', 'https://public.example/changed');
    await fixture.whenStable();
    expect(selected(3).getAttribute('aria-pressed')).toBe('true');
  });

  it('renders read-only cards and copies substituted text through the real native button', async () => {
    const fixture = await render('https://public.example/release');
    const host = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-1"]');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-linkedin-option"]').length).toBe(3);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-text"]').textContent).not.toContain('[LINK]');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-linkedin-add-link"]').length).toBe(0);
    const links = fixture.nativeElement.querySelectorAll('[data-testid="mktg-linkedin-share-link-1"]');
    expect(links.length).toBe(2);
    for (const link of links) expect(link.getAttribute('href')).toBe('https://public.example/release');
    host.click();
    await fixture.whenStable();
    expect(clipboard).not.toHaveBeenCalled();
    host.querySelector('button').click();
    await fixture.whenStable();
    expect(host.textContent).toContain('Copied');
    expect(clipboard).toHaveBeenCalledWith('Example post 1. https://public.example/release Again https://public.example/release\n\n#Code #Release #Community');
    expect(clipboard.mock.calls[0][0]).not.toContain('Verify handles');
  });
  it('drops old success and missing-link notices whenever the current copy text changes', async () => {
    const fixture = await render();
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-1"] button').click();
    await fixture.whenStable();
    expect(fixture.componentInstance['copied']()).toBe(1);
    expect(fixture.componentInstance['notice']()).toContain('[LINK]');
    fixture.componentRef.setInput('shareLink', 'https://public.example/new');
    fixture.detectChanges();
    expect(fixture.componentInstance['copied']()).toBeNull();
    expect(fixture.componentInstance['notice']()).toBe('');
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-1"] button').click();
    await fixture.whenStable();
    expect(clipboard.mock.calls.at(-1)?.[0]).toContain('https://public.example/new');
    fixture.componentRef.setInput('shareLink', '');
    fixture.detectChanges();
    expect(fixture.componentInstance['copied']()).toBeNull();
  });
  it('clears the previous success before a failed attempt and renders tagging separators explicitly', async () => {
    const fixture = await render();
    fixture.componentRef.setInput(
      'options',
      options.map((option) => ({ ...option, tagging_suggestions: ['Example project', 'Example community'] }))
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Example project; Example community');
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-1"] button').click();
    await fixture.whenStable();
    clipboard.mockRejectedValueOnce(new Error('Synthetic clipboard denial'));
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-2"] button').click();
    await fixture.whenStable();
    expect(fixture.componentInstance['copied']()).toBeNull();
    expect(fixture.componentInstance['notice']()).toBe('');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-error"]')).not.toBeNull();
  });

  it('uses highlighted chips without a URL and warns when copying unresolved placeholders', async () => {
    const fixture = await render();
    const chips = fixture.nativeElement.querySelectorAll('[data-testid="mktg-linkedin-add-link"]');
    expect(chips.length).toBe(6);
    for (const chip of chips) {
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.getAttribute('type')).toBe('button');
      expect(chip.getAttribute('aria-label')).toBe('Add your link');
      expect(chip.classList.contains('focus-visible:ring-2')).toBe(true);
    }
    const handoff = vi.fn();
    fixture.componentInstance.addLink.subscribe(handoff);
    chips[0].click();
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-text"]').textContent).toContain('add your link');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-text"]').textContent).not.toContain('[LINK]');
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-1"] button').click();
    await fixture.whenStable();
    expect(clipboard.mock.calls[0][0]).toContain('[LINK]');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-notice"]').textContent).toContain('still contains [LINK]');
  });
  it('shows an actionable error if clipboard access fails, not a false Copied label', async () => {
    clipboard.mockRejectedValueOnce(new Error('Synthetic clipboard denial'));
    const fixture = await render();
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-1"] button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-error"]').textContent).toContain('Clipboard unavailable');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-1"]').textContent).toContain('Copy post');
  });
});

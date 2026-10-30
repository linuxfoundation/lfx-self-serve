// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteReviewComponent } from './vote-review.component';

describe('VoteReviewComponent — description formatting (#4727)', () => {
  let fixture: ComponentFixture<VoteReviewComponent>;
  let form: FormGroup;

  const description = () => fixture.nativeElement.querySelector('[data-testid="vote-review-description"]') as HTMLElement | null;

  async function render(value: string): Promise<void> {
    form = new FormGroup({
      title: new FormControl('Charter ratification'),
      description: new FormControl(value),
      committee: new FormControl(null),
      eligible_participants: new FormControl(''),
      close_date: new FormControl(null),
      close_time: new FormControl(''),
      timezone: new FormControl('UTC'),
      allow_abstain: new FormControl(false),
      questions: new FormArray([]),
      commentPrompts: new FormArray([]),
    });
    fixture = TestBed.createComponent(VoteReviewComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [VoteReviewComponent], providers: [provideNoopAnimations()] });
  });

  afterEach(() => fixture?.destroy());

  it('preserves plain-text whitespace in a left-aligned block', async () => {
    const raw = '  First\n\n\n    - indented  bullet\n1.  numbered';
    await render(raw);

    expect(description()?.textContent).toBe(raw);
    expect(description()?.querySelector('span.whitespace-pre-wrap')?.children).toHaveLength(0);
    expect(description()?.classList.contains('whitespace-normal')).toBe(true);
    expect(description()?.classList.contains('text-left')).toBe(true);
  });

  it('preserves placeholders and entities as literal plain text', async () => {
    const raw = 'Use <username> to sign in &copy; at https://example.com';
    await render(raw);
    expect(description()?.textContent).toBe(raw);
    expect(description()?.querySelector('username')).toBeNull();
    expect(description()?.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('uses normal whitespace for rich HTML source indentation', async () => {
    await render('<ul> <li>One</li> <li>Two</li> </ul>');
    expect(description()?.classList.contains('whitespace-normal')).toBe(true);
    expect(description()?.querySelector('.whitespace-pre-wrap')).toBeNull();
    expect(description()?.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('renders supported HTML as elements, not literal tags', async () => {
    await render('<p>One <strong>b</strong></p><ul><li>A</li></ul>');

    expect(description()?.querySelector('p')).toBeTruthy();
    expect(description()?.querySelector('ul > li')?.textContent).toBe('A');
    expect(description()?.textContent).not.toContain('<p>');
  });

  it.each(['<p>Read <a href="https://example.com/charter"><strong>the charter</strong></a>.</p>', 'Read https://example.com/charter.'])(
    'opens a description link in a safe new tab without leaving the wizard: %s',
    async (value) => {
      await render(value);
      const link = description()?.querySelector('a');
      expect(link?.getAttribute('href')).toBe('https://example.com/charter');
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);

      try {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        (link?.querySelector('strong') ?? link)?.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(opened).toHaveBeenCalledExactlyOnceWith('https://example.com/charter', '_blank', 'noopener,noreferrer');
        expect(form.get('description')?.value).toBe(value);
      } finally {
        opened.mockRestore();
      }
    }
  );

  it('blocks private-host description links', async () => {
    await render('<a href="https://localhost/private">Private</a>');
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);

    try {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      description()?.querySelector('a')?.dispatchEvent(event);
      expect(description()?.querySelector('a')?.hasAttribute('href')).toBe(false);
      expect(opened).not.toHaveBeenCalled();
    } finally {
      opened.mockRestore();
    }
  });

  it('updates when the form value changes', async () => {
    await render('Before');
    form.get('description')?.setValue('After\n\nMore');
    fixture.detectChanges();

    expect(description()?.textContent).toBe('After\n\nMore');
  });

  it('strips unsafe content', async () => {
    await render('<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">l</a>');

    expect(description()?.querySelector('script')).toBeNull();
    expect(description()?.innerHTML).not.toContain('onerror');
    expect(description()?.querySelector('a')?.getAttribute('href')).toMatch(/^unsafe:/);
  });

  it('adds no description row when empty', async () => {
    await render('');

    expect(description()).toBeNull();
  });
});

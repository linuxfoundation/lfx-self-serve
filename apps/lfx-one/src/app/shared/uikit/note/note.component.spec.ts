// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiNoteComponent } from './note.component';

@Component({
  selector: 'lfx-ui-note-test-host',
  imports: [UiNoteComponent],
  template: `<lfx-ui-note variant="warning" fill label="Heads up:"
    >Membership renews in 14 days.<button note-action type="button" data-testid="host-action">Review</button></lfx-ui-note
  >`,
})
class HostComponent {}

describe('UiNoteComponent', () => {
  let fixture: ComponentFixture<UiNoteComponent>;
  let host: HTMLElement;

  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };
  const icon = (): string => (host.querySelector('[data-testid="ui-note-icon"] i') as HTMLElement).className;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiNoteComponent, HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiNoteComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('is a note by default and an alert when announced', async () => {
    expect(host.getAttribute('role')).toBe('note');

    await set('announce', true);

    expect(host.getAttribute('role')).toBe('alert');
  });

  it('is the info variant by default: a 50-step panel with no edge, 800 text and a decorative icon', () => {
    expect(host.className).toContain('bg-ui-accent-50');
    expect(host.className).toContain('text-ui-accent-800');
    expect(host.className).not.toContain('ring-');
    expect(icon()).toContain('fa-circle-info');
    expect(host.querySelector('[data-testid="ui-note-icon"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('colours every variant with its panel, its text step and its own icon', async () => {
    const cases: [string, string, string, string][] = [
      ['secondary', 'bg-ui-neutral-50', 'text-ui-neutral-600', 'fa-circle-info'],
      ['success', 'bg-ui-success-50', 'text-ui-success-800', 'fa-circle-check'],
      ['warning', 'bg-ui-warning-50', 'text-ui-warning-800', 'fa-triangle-exclamation'],
      ['error', 'bg-ui-danger-50', 'text-ui-danger-800', 'fa-circle-exclamation'],
      ['violet', 'bg-ui-feature-50', 'text-ui-feature-800', 'fa-wand-magic-sparkles'],
    ];
    for (const [variant, bg, text, iconClass] of cases) {
      await set('variant', variant);
      expect(host.className).toContain(bg);
      expect(host.className).toContain(text);
      expect(icon()).toContain(iconClass);
    }
  });

  it('deepens the panel to the 100 step with fill', async () => {
    await set('variant', 'success');
    await set('fill', true);

    expect(host.className).toContain('bg-ui-success-100');
    expect(host.className).not.toContain('bg-ui-success-50');
  });

  it('greys out when disabled, whatever the variant', async () => {
    await set('variant', 'error');
    await set('disabled', true);

    expect(host.className).toContain('bg-ui-neutral-50');
    expect(host.className).toContain('text-ui-neutral-500');
    expect(host.className).not.toContain('text-ui-danger-800');
    expect(host.className).not.toContain('bg-ui-danger-50');
  });

  it('centres the icon on the first line at every size', async () => {
    for (const [size, iconSize] of [
      ['default', 'text-[16px]'],
      ['small', 'text-[12px]'],
      ['tiny', 'text-[12px]'],
    ]) {
      await set('size', size);
      const wrapper = (host.querySelector('[data-testid="ui-note-icon"]') as HTMLElement).className;
      expect(wrapper).toContain(iconSize);
      expect(wrapper).toContain('h-[1lh]');
      expect(wrapper).toContain('items-center');
      expect(wrapper).not.toContain('pt-[2px]');
    }
  });

  it('is 40px tall with 14px text by default and 32px with 12px text when small', async () => {
    expect(host.className).toContain('min-h-[40px]');
    expect(host.className).toContain('copy-14');

    await set('size', 'small');

    expect(host.className).toContain('min-h-[32px]');
    expect(host.className).toContain('px-[12px]');
    expect(host.className).toContain('py-[8px]');
    expect(host.className).toContain('label-12');
  });

  it('is 24px tall with 12px text and an 8px radius when tiny', async () => {
    await set('size', 'tiny');

    expect(host.className).toContain('min-h-[24px]');
    expect(host.className).toContain('px-[8px]');
    expect(host.className).toContain('label-12');
    expect(host.className).toContain('rounded-[8px]');
  });

  it('drops the panel and padding when plain and keeps the colour and size', async () => {
    await set('variant', 'error');
    await set('fill', true);
    await set('size', 'small');
    await set('plain', true);

    expect(host.className).toContain('text-ui-danger-800');
    expect(host.className).toContain('label-12');
    expect(host.className).toContain('gap-[6px]');
    for (const boxed of ['bg-ui-danger-50', 'bg-ui-danger-100', 'px-[12px]', 'min-h-[32px]', 'rounded-ui-sm']) {
      expect(host.className).not.toContain(boxed);
    }
  });

  it('prefixes a medium-weight label only when given', async () => {
    expect(host.querySelector('[data-testid="ui-note-label"]')).toBeNull();

    await set('label', 'Beta:');

    expect(host.querySelector('[data-testid="ui-note-label"]')?.textContent).toBe('Beta:');
  });

  it('swaps the icon for a custom one', async () => {
    await set('icon', 'fa-light fa-bell');

    expect(icon()).toBe('ui-icon fa-light fa-bell');
  });

  it('projects the message and one action', async () => {
    const hostFixture = TestBed.createComponent(HostComponent);
    await hostFixture.whenStable();
    const el = hostFixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="ui-note-content"]')?.textContent).toContain('Membership renews in 14 days.');
    expect(el.querySelector('[data-testid="ui-note-label"]')?.textContent).toBe('Heads up:');
    expect(el.querySelector('lfx-ui-note > [data-testid="host-action"]')).not.toBeNull();
  });
});

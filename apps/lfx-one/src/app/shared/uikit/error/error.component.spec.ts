// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiErrorComponent } from './error.component';

@Component({
  selector: 'lfx-ui-error-test-host',
  imports: [UiErrorComponent],
  template: `<lfx-ui-error label="Error:" size="large">We could not verify your membership. <a href="#fix">Contact us</a></lfx-ui-error>`,
})
class TestHostComponent {}

describe('UiErrorComponent', () => {
  let fixture: ComponentFixture<UiErrorComponent>;
  let host: HTMLElement;

  const icon = () => host.querySelector('[data-testid="ui-error-icon"]') as HTMLElement;
  const label = () => host.querySelector('[data-testid="ui-error-label"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiErrorComponent, TestHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiErrorComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('renders a red 14px message with a decorative icon and role alert', () => {
    expect(host.getAttribute('role')).toBe('alert');
    expect(host.className).toContain('text-ui-danger-700');
    expect(host.className).toContain('copy-14');
    expect(icon().getAttribute('aria-hidden')).toBe('true');
    expect(icon().className).toContain('fa-circle-exclamation');
    expect(icon().className).toContain('text-[16px]');
    expect(label()).toBeNull();
  });

  it.each([
    ['small', 'copy-13', 'text-[14px]', 'pt-[2px]'],
    ['default', 'copy-14', 'text-[16px]', 'pt-[2px]'],
    ['large', 'copy-16', 'text-[18px]', 'pt-[3px]'],
  ] as const)('sizes the %s variant', async (size, textClass, iconSize, iconPad) => {
    fixture.componentRef.setInput('size', size);
    await fixture.whenStable();

    expect(host.className).toContain(textClass);
    expect(icon().className).toContain(iconSize);
    expect(icon().className).toContain(iconPad);
  });

  it('shows a medium-weight label before the message', async () => {
    fixture.componentRef.setInput('label', 'Email error:');
    await fixture.whenStable();

    expect(label()?.textContent).toBe('Email error:');
    expect(label()?.className).toContain('font-medium');
  });

  it('drops role alert when announce is off', async () => {
    fixture.componentRef.setInput('announce', false);
    await fixture.whenStable();

    expect(host.getAttribute('role')).toBeNull();
  });

  it('projects the message and a link', async () => {
    const hostFixture = TestBed.createComponent(TestHostComponent);
    await hostFixture.whenStable();
    const el = hostFixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="ui-error-message"]')?.textContent).toContain('We could not verify your membership.');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('#fix');
    expect(el.querySelector('lfx-ui-error')?.className).toContain('[&_a]:underline');
    expect(el.querySelector('lfx-ui-error')?.className).toContain('copy-16');
  });
});

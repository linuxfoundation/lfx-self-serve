// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AccountCardComponent } from './account-card.component';

// Set in the TestBed below: inline templates are capped at three lines.
const HOST_TEMPLATE = `
  <lfx-account-card heading="Location" [subtitle]="subtitle()" testId="card">
    <button accountCardActions type="button">Add</button>
    <p data-testid="card-body">Fields</p>
  </lfx-account-card>
`;

@Component({ selector: 'lfx-test-host', template: '' })
class TestHostComponent {
  public readonly subtitle = signal('Where we send swag.');
}

describe('AccountCardComponent', () => {
  const render = async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    TestBed.overrideComponent(TestHostComponent, { set: { imports: [AccountCardComponent], template: HOST_TEMPLATE } });
    const fixture = TestBed.createComponent(TestHostComponent);
    await fixture.whenStable();
    return fixture;
  };

  it('names the card by its title and shows the subtitle, action and content', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;
    const section = host.querySelector('[data-testid="card"]') as HTMLElement;
    const title = host.querySelector('[data-testid="card-title"]') as HTMLElement;

    expect(title.tagName).toBe('H2');
    expect(section.getAttribute('aria-labelledby')).toBe(title.id);
    expect(host.querySelector('[data-testid="card-subtitle"]')?.textContent).toBe('Where we send swag.');
    expect(host.querySelector('button')?.textContent).toBe('Add');
    expect(host.querySelector('[data-testid="card-body"]')).not.toBeNull();
  });

  it('leaves the subtitle out when there is none', async () => {
    const fixture = await render();
    fixture.componentInstance.subtitle.set('');
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="card-subtitle"]')).toBeNull();
  });
});

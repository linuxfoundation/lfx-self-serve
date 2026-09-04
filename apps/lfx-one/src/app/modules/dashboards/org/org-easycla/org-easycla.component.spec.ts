// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgEasyclaComponent } from './org-easycla.component';

describe('OrgEasyclaComponent', () => {
  const selectedAccount = signal<{ accountName: string } | null>(null);

  async function render(): Promise<ComponentFixture<OrgEasyclaComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: AccountContextService, useValue: { selectedAccount } }],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    selectedAccount.set(null);
  });

  it('renders the empty-state scaffold', async () => {
    const fixture = await render();
    const page = fixture.nativeElement.querySelector('[data-testid="org-easycla-page"]');
    const empty = fixture.nativeElement.querySelector('[data-testid="org-easycla-empty-state"]');

    expect(page).toBeTruthy();
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No CLAs signed yet');
  });

  // Matches the sibling org-lens pages (memberships, projects) and the approved M3 design,
  // which titles the page "EasyCLA — {Company}".
  it('titles the page with the selected company', async () => {
    selectedAccount.set({ accountName: 'Acme Motors, Inc.' });

    const fixture = await render();
    const title = fixture.nativeElement.querySelector('[data-testid="org-easycla-title"]');

    expect(title.textContent).toContain('EasyCLA');
    expect(title.textContent).toContain('Acme Motors, Inc.');
  });

  it('falls back to the bare title before an account resolves', async () => {
    const fixture = await render();
    const title = fixture.nativeElement.querySelector('[data-testid="org-easycla-title"]');

    expect(title.textContent).toContain('EasyCLA');
    expect(title.textContent).not.toContain('—');
  });
});

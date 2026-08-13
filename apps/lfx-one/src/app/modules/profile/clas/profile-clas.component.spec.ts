// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { MyClaAgreement, MyClasResponse } from '@lfx-one/shared/interfaces';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyClasService } from '@services/my-clas.service';
import { MenuItem } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileClasComponent } from './profile-clas.component';

describe('ProfileClasComponent', () => {
  const agreement = (overrides: Partial<MyClaAgreement> = {}): MyClaAgreement => ({
    id: 's1',
    kind: 'ICLA',
    claGroupName: 'Project One',
    signedOn: '2022-01-01',
    status: 'valid',
    pdfAvailable: true,
    ...overrides,
  });

  let fixture: ComponentFixture<ProfileClasComponent>;

  async function render(agreements: MyClaAgreement[]): Promise<void> {
    const response: MyClasResponse = {
      agreements,
      identity: { matchedUserIds: agreements.length > 0 ? 1 : 0, unmatched: agreements.length === 0, githubLinked: true },
    };

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProfileClasComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: MyClasService, useValue: { getMyClas: () => of(response), getPdfUrl: vi.fn() } }],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileClasComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function statusTag(id: string): TagComponent {
    const el = fixture.debugElement.query(By.css(`[data-testid="agreement-status-${id}"]`));
    if (!el) throw new Error(`no status tag rendered for ${id}`);
    return el.componentInstance as TagComponent;
  }

  function menuItems(id: string): MenuItem[] {
    const row = fixture.debugElement.query(By.css(`[data-testid="agreement-row-${id}"]`));
    if (!row) throw new Error(`no row rendered for ${id}`);
    const menu = row.query(By.directive(MenuComponent));
    if (!menu) throw new Error(`no row menu rendered for ${id}`);
    return (menu.componentInstance as MenuComponent).model() ?? [];
  }

  function headers(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('th') as NodeListOf<HTMLElement>).map((th) => th.textContent?.trim() ?? '');
  }

  it('renders Valid / Needs attention / Invalidated with the matching severities', async () => {
    await render([
      agreement({ id: 's-valid', status: 'valid' }),
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    expect(statusTag('s-valid').value()).toBe('Valid');
    expect(statusTag('s-valid').severity()).toBe('success');
    expect(statusTag('s-attn').value()).toBe('Needs attention');
    expect(statusTag('s-attn').severity()).toBe('warn');
    expect(statusTag('s-inv').value()).toBe('Invalidated');
    expect(statusTag('s-inv').severity()).toBe('danger');
  });

  it('renders an invalidated row instead of the empty state', async () => {
    await render([agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false })]);

    expect(fixture.nativeElement.querySelector('[data-testid="my-clas-empty-state"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-row-s-inv"]')).toBeTruthy();
  });

  it('does not render an explanatory note for any status', async () => {
    await render([
      agreement({ id: 's-valid', status: 'valid' }),
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', pdfAvailable: false }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    expect(fixture.nativeElement.querySelector('[data-testid^="agreement-status-note-"]')).toBeNull();
  });

  it('lists Project, Type, Status, Signed, then an unlabelled actions column, with no Document column', async () => {
    await render([agreement()]);

    expect(headers()).toEqual(['Project', 'Type', 'Status', 'Signed', '']);
    expect(fixture.nativeElement.textContent).not.toContain('Document');
  });

  it('offers an enabled Download PDF item on an ICLA row with a document', async () => {
    await render([agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true })]);

    const items = menuItems('s-icla');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('Download PDF');
    expect(items[0].disabled).toBeFalsy();
  });

  it('shows a disabled Covered by Corporate CLA item on an ECLA row', async () => {
    await render([agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, companyName: 'Acme' })]);

    expect(menuItems('s-ecla')).toEqual([expect.objectContaining({ label: 'Covered by Corporate CLA (CCLA)', disabled: true })]);
  });

  it('does not render placeholder Invalidate or Request approval items', async () => {
    await render([
      agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true }),
      agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, status: 'needs_attention' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    const labels = ['s-icla', 's-ecla', 's-inv'].flatMap((id) => menuItems(id).map((item) => item.label ?? ''));
    expect(labels.some((label) => /invalidate|request approval/i.test(label))).toBe(false);
  });
});

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MyClaAgreement } from '@lfx-one/shared/interfaces';
import { DialogService } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { buildContactClaManagerMenuItems } from './contact-cla-manager-menu';
import { CLA_MANAGER_MODAL_COPY, ContactClaManagerComponent } from './contact-cla-manager.component';

function agreement(overrides: Partial<MyClaAgreement> = {}): MyClaAgreement {
  return {
    id: 's-ecla',
    kind: 'ECLA',
    claGroupName: 'CNCF',
    projectName: 'Cloud Native Computing Foundation (CNCF)',
    signedOn: '2022-01-01',
    status: 'valid',
    pdfAvailable: false,
    ...overrides,
  };
}

function labels(items: ReturnType<typeof buildContactClaManagerMenuItems>): string[] {
  return items.map((item) => item.label ?? '');
}

describe('buildContactClaManagerMenuItems', () => {
  const dialog = { open: vi.fn() } as unknown as DialogService;

  it('returns nothing for ICLA and Revoked rows', () => {
    expect(buildContactClaManagerMenuItems(agreement({ kind: 'ICLA', pdfAvailable: true }), dialog)).toEqual([]);
    expect(buildContactClaManagerMenuItems(agreement({ status: 'revoked' }), dialog)).toEqual([]);
  });

  it('offers only Request Removal on a Valid ECLA', () => {
    expect(labels(buildContactClaManagerMenuItems(agreement({ status: 'valid' }), dialog))).toEqual(['Request Removal']);
  });

  it('offers approval, removal, and contact on Needs-attention + not_on_approval_list', () => {
    expect(labels(buildContactClaManagerMenuItems(agreement({ status: 'needs_attention', statusReason: 'not_on_approval_list' }), dialog))).toEqual([
      'Request approval',
      'Request Removal',
      'Contact CLA Manager',
    ]);
  });

  it('hides Request approval when the reason is not an approval-list miss', () => {
    expect(labels(buildContactClaManagerMenuItems(agreement({ status: 'needs_attention', statusReason: 'unknown' }), dialog))).toEqual([
      'Request Removal',
      'Contact CLA Manager',
    ]);
  });

  it('opens the shared modal in the matching mode', () => {
    const open = vi.fn();
    const items = buildContactClaManagerMenuItems(agreement({ status: 'needs_attention', statusReason: 'not_on_approval_list' }), {
      open,
    } as unknown as DialogService);

    items[0]?.command?.({} as never);

    expect(open).toHaveBeenCalledWith(
      ContactClaManagerComponent,
      expect.objectContaining({
        header: CLA_MANAGER_MODAL_COPY.approval.title,
        data: {
          signatureId: 's-ecla',
          projectName: 'Cloud Native Computing Foundation (CNCF)',
          mode: 'approval',
        },
      })
    );
  });
});

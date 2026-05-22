// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgMembershipAgreement, OrgMembershipCertificateTemplate, OrgMembershipDocumentsResponse } from '@lfx-one/shared/interfaces';

import sharedFixture from './fixtures/org-membership-documents.mock.json';

const SHARED_FIXTURE = sharedFixture as {
  agreements: OrgMembershipAgreement[];
  certificateTemplate: OrgMembershipCertificateTemplate;
};

export class OrgLensDocumentsService {
  public getMembershipDocuments(accountId: string, foundationId: string): OrgMembershipDocumentsResponse {
    return {
      accountId,
      foundationId,
      agreements: structuredClone(SHARED_FIXTURE.agreements),
      certificateTemplate: structuredClone(SHARED_FIXTURE.certificateTemplate),
    };
  }
}

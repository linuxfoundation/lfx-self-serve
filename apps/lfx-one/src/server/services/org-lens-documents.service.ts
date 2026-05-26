// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgMembershipAgreement, OrgMembershipCertificateTemplate, OrgMembershipDocumentsResult } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

/** Raw Snowflake row from ORG_LENS_MEMBERSHIP_AGREEMENTS; UPPER_CASE matches Snowflake's default column case. */
interface RawAgreementRow {
  ASSET_ID: string;
  AGREEMENT_ID: string;
  AGREEMENT_NAME: string;
  SIGNED_DATE: string | null;
  MEMBERSHIP_TIER: string;
  MEMBERSHIP_STATUS_RAW: string;
  IS_CURRENT: boolean;
  FORMAT: string;
  DOWNLOAD_URL: string | null;
}

/** Raw Snowflake row from ORG_LENS_TLF_CERTIFICATE (spec 019); shaped by `shapeCertificateRow`. */
interface RawCertificateRow {
  ACCOUNT_NAME: string;
  MEMBERSHIP_TIER: string;
  CERTIFICATE_TITLE: string;
  CERTIFICATE_SUBTITLE: string;
  TLF_MEMBER_SINCE: string;
  MEMBER_SINCE_FORMATTED: string;
  TIER_START_DATE: string;
  TIER_END_DATE: string;
  CERTIFICATE_DOWNLOAD_URL: string | null;
}

/** Serves membership documents + TLF certificate from Snowflake (spec 018/019). */
export class OrgLensDocumentsService {
  private static readonly agreementsSql = `
    SELECT
      ASSET_ID,
      AGREEMENT_ID,
      AGREEMENT_NAME,
      SIGNED_DATE,
      MEMBERSHIP_TIER,
      MEMBERSHIP_STATUS_RAW,
      IS_CURRENT,
      FORMAT,
      DOWNLOAD_URL
    FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_MEMBERSHIP_AGREEMENTS
    WHERE ACCOUNT_ID = ? AND FOUNDATION_ID = ?
    ORDER BY SIGNED_DATE DESC NULLS LAST, ASSET_ID
  `;

  // FR-010: MEMBER_SINCE_FORMATTED is pre-computed in SQL; LIMIT 1 is defensive against duplicate rows.
  private static readonly certificateSql = `
    SELECT
      ACCOUNT_NAME,
      MEMBERSHIP_TIER,
      CERTIFICATE_TITLE,
      CERTIFICATE_SUBTITLE,
      TLF_MEMBER_SINCE,
      TO_CHAR(TLF_MEMBER_SINCE, 'Mon YYYY') AS MEMBER_SINCE_FORMATTED,
      TIER_START_DATE,
      TIER_END_DATE,
      CERTIFICATE_DOWNLOAD_URL
    FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_TLF_CERTIFICATE
    WHERE ACCOUNT_ID = ?
    ORDER BY TIER_START_DATE DESC NULLS LAST, TIER_END_DATE DESC NULLS LAST
    LIMIT 1
  `;

  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async getMembershipDocuments(req: Request, accountId: string, foundationId: string): Promise<OrgMembershipDocumentsResult> {
    const agreementsQuery = this.snowflakeService.execute<RawAgreementRow>(OrgLensDocumentsService.agreementsSql, [accountId, foundationId]);
    const certificateQuery = this.snowflakeService.execute<RawCertificateRow>(OrgLensDocumentsService.certificateSql, [accountId]);

    const [agreementsResult, certificateResult] = await Promise.allSettled([agreementsQuery, certificateQuery]);

    // Agreements failure fails the whole tab (primary content).
    if (agreementsResult.status === 'rejected') {
      throw agreementsResult.reason;
    }

    // Defensive: Snowflake SDK callback types rows as `any[] | undefined`.
    const agreementRows = agreementsResult.value.rows ?? [];
    const agreements: OrgMembershipAgreement[] = agreementRows.map((raw) => this.shapeAgreementRow(raw));

    // Certificate query degrades silently per FR-010a — UI hides the card via @if guard.
    let certificateTemplate: OrgMembershipCertificateTemplate | null = null;
    let certificateDegraded = false;

    if (certificateResult.status === 'rejected') {
      logger.warning(req, 'certificate_query_failed', 'TLF certificate query failed; degrading card silently', {
        account_id: accountId,
        err: certificateResult.reason,
      });
      certificateDegraded = true;
    } else {
      const certRows = certificateResult.value.rows ?? [];
      const certRow = certRows[0];
      certificateTemplate = certRow ? this.shapeCertificateRow(certRow) : null;
    }

    return {
      response: {
        accountId,
        foundationId,
        agreements,
        certificateTemplate,
      },
      certificateDegraded,
    };
  }

  private shapeAgreementRow(raw: RawAgreementRow): OrgMembershipAgreement {
    return {
      id: raw.AGREEMENT_ID,
      name: raw.AGREEMENT_NAME,
      signedDate: this.formatDate(raw.SIGNED_DATE),
      format: raw.FORMAT,
      fileSizeKb: null,
      isCurrent: raw.IS_CURRENT,
      downloadUrl: raw.DOWNLOAD_URL,
      statusRaw: raw.MEMBERSHIP_STATUS_RAW,
      tier: raw.MEMBERSHIP_TIER,
    };
  }

  private shapeCertificateRow(raw: RawCertificateRow): OrgMembershipCertificateTemplate {
    return {
      title: raw.CERTIFICATE_TITLE,
      subtitle: raw.CERTIFICATE_SUBTITLE,
      membershipTier: raw.MEMBERSHIP_TIER,
      issuedTo: raw.ACCOUNT_NAME,
      memberSinceFormatted: raw.MEMBER_SINCE_FORMATTED,
      memberSinceDate: this.formatDate(raw.TLF_MEMBER_SINCE),
      downloadUrl: raw.CERTIFICATE_DOWNLOAD_URL,
    };
  }

  /** Normalize a Snowflake DATE value to "YYYY-MM-DD"; returns "" for null/empty (UI renders "" as em-dash). */
  private formatDate(value: string | null): string {
    if (!value) return '';
    return new Date(value).toISOString().split('T')[0];
  }
}

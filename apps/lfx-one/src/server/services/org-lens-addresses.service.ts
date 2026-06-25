// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgAddress, OrgAddressesResponse, OrgLensAddressesWarehouseRow } from '@lfx-one/shared/interfaces';

import { SnowflakeService } from './snowflake.service';

export class OrgLensAddressesService {
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async getAddresses(accountId: string): Promise<OrgAddressesResponse> {
    const query = `
      SELECT
        BILLING_STREET,
        BILLING_CITY,
        BILLING_STATE,
        BILLING_POSTAL_CODE,
        BILLING_COUNTRY,
        SHIPPING_STREET,
        SHIPPING_CITY,
        SHIPPING_STATE,
        SHIPPING_POSTAL_CODE,
        SHIPPING_COUNTRY
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_ADDRESSES
      WHERE ACCOUNT_ID = ?
    `;

    const result = await this.snowflakeService.execute<OrgLensAddressesWarehouseRow>(query, [accountId]);

    if (result.rows.length === 0) {
      return { primaryAddress: null, billingAddress: null };
    }

    const row = result.rows[0];

    return {
      primaryAddress: this.buildAddress(row.SHIPPING_STREET, row.SHIPPING_CITY, row.SHIPPING_STATE, row.SHIPPING_POSTAL_CODE, row.SHIPPING_COUNTRY),
      billingAddress: this.buildAddress(row.BILLING_STREET, row.BILLING_CITY, row.BILLING_STATE, row.BILLING_POSTAL_CODE, row.BILLING_COUNTRY),
    };
  }

  private buildAddress(street: string | null, city: string | null, state: string | null, postalCode: string | null, country: string | null): OrgAddress | null {
    const hasData = [street, city, state, postalCode, country].some((v) => v !== null && v !== '');
    if (!hasData) return null;

    return {
      line1: street ?? '',
      city: city ?? '',
      stateProvince: state ?? '',
      postalCode: postalCode ?? '',
      country: country ?? '',
    };
  }
}

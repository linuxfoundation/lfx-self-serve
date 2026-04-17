// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Transaction, TransactionRow } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

const TRANSACTIONS_QUERY = `
  SELECT _KEY, ORDER_ID, NAME, NET_REVENUE,
         CREATED_DATE, TRANSACTION_TYPE, PROJECT_ID, PROJECT_NAME
  FROM ANALYTICS.PLATINUM_LFX_ONE.USER_TRANSACTIONS
  WHERE USER_NAME = ?
  ORDER BY CREATED_DATE DESC
`;

export class TransactionService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async getTransactions(req: Request, username: string): Promise<Transaction[]> {
    logger.debug(req, 'get_transactions', 'Fetching transactions from Snowflake', { username });

    let result: { rows: TransactionRow[] };

    try {
      result = await this.snowflakeService.execute<TransactionRow>(TRANSACTIONS_QUERY, [username]);
    } catch (error) {
      logger.warning(req, 'get_transactions', 'Snowflake query failed, returning empty transactions', {
        error: error instanceof Error ? error.message : String(error),
      });

      return [];
    }

    logger.debug(req, 'get_transactions', 'Fetched transactions', { count: result.rows.length });

    return result.rows.map((row) => this.mapRowToTransaction(row));
  }

  private mapRowToTransaction(row: TransactionRow): Transaction {
    return {
      id: row._KEY,
      orderId: row.ORDER_ID,
      createdDate: row.CREATED_DATE,
      name: row.NAME ?? '',
      transactionType: row.TRANSACTION_TYPE,
      netRevenue: row.NET_REVENUE ?? 0,
      projectId: row.PROJECT_ID,
      projectName: row.PROJECT_NAME,
    };
  }
}

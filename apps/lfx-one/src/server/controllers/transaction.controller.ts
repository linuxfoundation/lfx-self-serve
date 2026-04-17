// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { logger } from '../services/logger.service';
import { TransactionService } from '../services/transaction.service';
import { getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';

export class TransactionController {
  private readonly transactionService = new TransactionService();

  /**
   * GET /api/transactions
   * Get all transactions for the authenticated user
   */
  public async getTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_transactions');

    try {
      const rawUsername = await getUsernameFromAuth(req);

      if (!rawUsername) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_transactions',
        });
      }

      const username = stripAuthPrefix(rawUsername);
      const transactions = await this.transactionService.getTransactions(req, username);

      logger.success(req, 'get_transactions', startTime, {
        result_count: transactions.length,
      });

      res.json(transactions);
    } catch (error) {
      next(error);
    }
  }
}

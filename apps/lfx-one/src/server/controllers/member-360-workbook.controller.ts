// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEMBER_360_TRACKER_FILENAME_HEADER, MEMBER_360_WORKBOOK_CONTENT_TYPE } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { Member360WorkbookService } from '../services/member-360-workbook.service';

export class Member360WorkbookController {
  private readonly service = new Member360WorkbookService();

  public async download(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'member_360_workbook';
    const start = logger.startOperation(req, operation, {});
    try {
      const project = this.query(req, 'project');
      const documentId = String(req.params['documentId'] ?? '');
      const workbook = await this.service.download(req, project, documentId);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', MEMBER_360_WORKBOOK_CONTENT_TYPE);
      res.attachment(workbook.filename);
      logger.success(req, operation, start, { bytes: workbook.bytes.length });
      res.send(Buffer.from(workbook.bytes));
    } catch (error) {
      next(error);
    }
  }

  public async parseTracker(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'member_360_tracker';
    const start = logger.startOperation(req, operation, {});
    try {
      // Match the document-upload transport: URI-encoded header, never a logged URL.
      const raw = req.headers[MEMBER_360_TRACKER_FILENAME_HEADER.toLowerCase()];
      if (typeof raw !== 'string') throw ServiceValidationError.forField('filename', 'A tracker filename header is required.', { operation });
      let filename: string;
      try {
        filename = decodeURIComponent(raw);
      } catch {
        throw ServiceValidationError.forField('filename', 'Use a URI-encoded tracker filename header.', { operation });
      }
      const tracker = await this.service.parseTracker(req, this.query(req, 'project'), filename, req.body);
      logger.success(req, operation, start, { rows: tracker.rows.length });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(tracker);
    } catch (error) {
      next(error);
    }
  }

  private query(req: Request, key: string): string {
    const value = req.query[key];
    if (typeof value !== 'string' || !value.trim())
      throw ServiceValidationError.forField(key, `${key} is required.`, { operation: 'member_360_workbook', service: 'member_360_workbook' });
    return value;
  }
}

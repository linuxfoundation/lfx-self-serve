// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MEMBER_360_MAX_BYTES,
  MEMBER_360_MAX_TRACKER_ROWS,
  MEMBER_360_MAX_TRACKER_COLUMNS,
  MEMBER_360_TRACKER_FILENAME_REGEX,
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_RUN_DOCUMENT_ID_PREFIX,
} from '@lfx-one/shared/constants';
import { Member360Tracker, Member360TrackerReceipt, Member360WorkbookDownload } from '@lfx-one/shared/interfaces';
import { envelopeSchema, findMktgDocumentType } from '@lfx-one/shared/server';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { AuthorizationError, isServiceValidationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { buildMember360Workbook, member360TrackerFromRows, parseMember360Csv, parseMember360Xlsx } from '../utils/member-360-workbook.util';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ProjectService } from './project.service';
import { Member360TrackerStoreService } from './member-360-tracker-store.service';

/** A workbook belongs to its stored run; assembly never accepts client-supplied tabs. */
export class Member360WorkbookService {
  private readonly documents = new MktgDocumentStoreService();
  private readonly projects = new ProjectService();
  private readonly trackers = new Member360TrackerStoreService();

  public async download(req: Request, projectUid: string, documentId: string): Promise<Member360WorkbookDownload> {
    if (!MKTG_DOCUMENT_ID_REGEX.test(documentId) || !documentId.startsWith(MKTG_RUN_DOCUMENT_ID_PREFIX))
      throw this.invalid('documentId', 'A run document id is required.');
    const project = await this.resolveWriter(req, projectUid);
    const type = findMktgDocumentType('member-360');
    if (!type)
      throw new MicroserviceError('Member 360 document type is not configured.', 503, 'MEMBER_360_UNAVAILABLE', {
        operation: 'member_360_workbook',
        service: 'member_360_workbook',
      });
    const document = await this.documents.getDocument(req, project, type, documentId);
    const revisionId = document?.revisions[0]?.id;
    const revision = revisionId ? await this.documents.getRevision(req, project, type, documentId, revisionId) : null;
    const envelope = revision?.member360;
    if (
      !envelope ||
      !envelopeSchema.safeParse(envelope).success ||
      envelope.project_uid !== project ||
      createHash('sha256').update(JSON.stringify(envelope.tabs)).digest('hex') !== envelope.content_sha256
    ) {
      throw new ResourceNotFoundError('Stored Member 360 run', documentId, { operation: 'member_360_workbook', service: 'member_360_workbook' });
    }
    logger.debug(req, 'member_360_workbook', 'Building workbook from the stored, integrity-checked run', { project, document: documentId });
    return { bytes: new Uint8Array(await buildMember360Workbook(envelope)), filename: `Member360_${envelope.project}_${envelope.period.label}.xlsx` };
  }

  public async parseTracker(req: Request, projectUid: string, filename: unknown, bytes: Buffer): Promise<Member360TrackerReceipt> {
    const project = await this.resolveWriter(req, projectUid);
    await this.trackers.sweepExpired(req, project);
    // `Array.isArray` is redundant against `Buffer.isBuffer` at runtime; it is kept because CodeQL's
    // js/type-confusion only clears the express body once the array shape is excluded explicitly.
    if (
      typeof filename !== 'string' ||
      !MEMBER_360_TRACKER_FILENAME_REGEX.test(filename) ||
      Array.isArray(bytes) ||
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > MEMBER_360_MAX_BYTES
    ) {
      throw this.invalid('tracker', 'Upload a CSV or XLSX tracker smaller than 5 MB.');
    }
    let tracker: Member360Tracker;
    try {
      tracker = /\.xlsx$/i.test(filename)
        ? await parseMember360Xlsx(filename, new Uint8Array(bytes).buffer)
        : member360TrackerFromRows(filename, parseMember360Csv(bytes.toString('utf8')));
      if (Buffer.byteLength(JSON.stringify(tracker)) > MEMBER_360_MAX_BYTES) throw this.invalid('tracker', 'Parsed tracker exceeds 5 MB.');
    } catch (error) {
      if (isServiceValidationError(error)) throw error;
      throw this.invalid(
        'tracker',
        `Use a single-sheet CSV/XLSX with unique headers, 1 to ${MEMBER_360_MAX_TRACKER_ROWS.toLocaleString('en-US')} data rows, at most ${MEMBER_360_MAX_TRACKER_COLUMNS} columns and at most 5 MB expanded data.`
      );
    }
    // Store failures keep their classification, not a misleading parser error.
    return this.trackers.save(req, project, tracker);
  }

  public async deleteTracker(req: Request, projectUid: string, id: string): Promise<void> {
    const project = await this.resolveWriter(req, projectUid);
    await this.trackers.remove(req, project, id);
  }

  private async resolveWriter(req: Request, uid: string): Promise<string> {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(uid)) throw this.invalid('project', 'A single-segment project uid is required.');
    const project = await this.projects.getProjectById(req, uid, true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
      throw new AuthorizationError('You need write access to this project to use Member 360 workbooks and trackers.', {
        operation: 'member_360_workbook',
        service: 'member_360_workbook',
      });
    }
    return project.uid;
  }

  private invalid(field: string, message: string): ServiceValidationError {
    return ServiceValidationError.forField(field, message, { operation: 'member_360_workbook', service: 'member_360_workbook' });
  }
}

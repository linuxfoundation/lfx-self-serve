// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ALLOWED_FILE_TYPES } from '@lfx-one/shared/constants';
import {
  CommitteeCreateData,
  CommitteeUpdateData,
  CreateCommitteeDocumentRequest,
  CreateCommitteeMemberRequest,
  CreateCommitteeJoinApplicationRequest,
  UploadCommitteeDocumentRequest,
} from '@lfx-one/shared/interfaces';
import { isFileTypeAllowed } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

import { ServiceValidationError } from '../errors';
import { buildVCalendar, fetchAllMeetingPages, meetingsToVEvents } from '../helpers/ics.helper';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { CommitteeService } from '../services/committee.service';
import { MeetingService } from '../services/meeting.service';
import { generateM2MToken } from '../utils/m2m-token.util';

/**
 * Build an RFC 5987 compliant `Content-Disposition: attachment` header value
 * with both an ASCII fallback (`filename=`) and a UTF-8 encoded variant
 * (`filename*=UTF-8''...`). The ASCII fallback strips non-ASCII characters and
 * neutralizes quotes / backslashes / control chars to prevent header injection
 * (CR/LF) and broken responses. Mirrors the pattern in `document.controller.ts`.
 */
function contentDispositionAttachment(fileName: string): string {
  const safeAscii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

const FOLDER_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Controller for handling committee HTTP requests
 */
export class CommitteeController {
  private committeeService: CommitteeService = new CommitteeService();
  private meetingService: MeetingService = new MeetingService();

  /**
   * GET /committees
   */
  public async getCommittees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_committees', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const data = await this.committeeService.getCommittees(req, req.query);

      logger.success(req, 'get_committees', startTime, {
        committee_count: data.length,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /committees/count
   */
  public async getCommitteesCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_committees_count', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const count = await this.committeeService.getCommitteesCount(req, req.query);

      logger.success(req, 'get_committees_count', startTime, {
        count,
      });

      res.json({ count });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /committees/my-committees
   * Returns committees the current user is a member of, with their role in each.
   */
  public async getMyCommittees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = req.query['project_uid'] as string | undefined;
    const foundationUid = req.query['foundation_uid'] as string | undefined;
    const startTime = logger.startOperation(req, 'get_my_committees', { project_uid: projectUid, foundation_uid: foundationUid });

    try {
      const myCommittees = await this.committeeService.getMyCommittees(req, projectUid, foundationUid);

      logger.success(req, 'get_my_committees', startTime, {
        committee_count: myCommittees.length,
      });

      res.json(myCommittees);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /committees/:id
   */
  public async getCommitteeById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_committee_by_id', {
      committee_id: id,
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'get_committee_by_id',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Get the committee by ID — include caller membership so the UI can render
      // visitor / member / chair states without a second round-trip.
      const committee = await this.committeeService.getCommitteeById(req, id, { includeMembership: true });

      // Log the success
      logger.success(req, 'get_committee_by_id', startTime, {
        committee_id: id,
        committee_category: committee.category,
      });

      // Send the committee data to the client
      res.json(committee);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /committees
   */
  public async createCommittee(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'create_committee', {
      committee_data: logger.sanitize(req.body),
    });

    try {
      const committeeData: CommitteeCreateData = req.body;
      // Create the committee
      const newCommittee = await this.committeeService.createCommittee(req, committeeData);

      // Log the success
      logger.success(req, 'create_committee', startTime, {
        committee_id: newCommittee.uid,
        committee_category: newCommittee.category,
      });

      // Send the new committee data to the client
      res.status(201).json(newCommittee);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * PUT /committees/:id
   */
  public async updateCommittee(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'update_committee', {
      committee_id: id,
      update_data: logger.sanitize(req.body),
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'update_committee',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Get the update data
      const updateData: CommitteeUpdateData = req.body;

      // Update the committee
      const updatedCommittee = await this.committeeService.updateCommittee(req, id, updateData);

      // Log the success
      logger.success(req, 'update_committee', startTime, {
        committee_id: id,
      });

      // Send the updated committee data to the client
      res.json(updatedCommittee);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /committees/:id
   */
  public async deleteCommittee(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'delete_committee', {
      committee_id: id,
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'delete_committee',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Delete the committee
      await this.committeeService.deleteCommittee(req, id);

      // Log the success
      logger.success(req, 'delete_committee', startTime, {
        committee_id: id,
      });

      // Send the response to the client
      res.status(204).send();
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /committees/:id/members
   */
  public async getCommitteeMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_committee_members', {
      committee_id: id,
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'get_committee_members',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Get the committee members
      const members = await this.committeeService.getCommitteeMembers(req, id, req.query);

      // Log the success
      logger.success(req, 'get_committee_members', startTime, {
        committee_id: id,
        member_count: members.length,
      });

      // Send the members data to the client
      res.json(members);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /committees/:id/members/:memberId
   */
  public async getCommitteeMemberById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, memberId } = req.params;
    const startTime = logger.startOperation(req, 'get_committee_member_by_id', {
      committee_id: id,
      member_id: memberId,
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'get_committee_member_by_id',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Check if the member ID is provided
      if (!memberId) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('memberId', 'Member ID is required', {
          operation: 'get_committee_member_by_id',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Get the committee member by ID
      const member = await this.committeeService.getCommitteeMemberById(req, id, memberId);

      // Log the success
      logger.success(req, 'get_committee_member_by_id', startTime, {
        committee_id: id,
        member_id: memberId,
      });

      // Send the member data to the client
      res.json(member);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /committees/:id/members
   */
  public async createCommitteeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'create_committee_member', {
      committee_id: id,
      member_data: logger.sanitize(req.body),
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'create_committee_member',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Get the member data
      const memberData: CreateCommitteeMemberRequest = req.body;

      // Create the committee member
      const newMember = await this.committeeService.createCommitteeMember(req, id, memberData);

      // Log the success
      logger.success(req, 'create_committee_member', startTime, {
        committee_id: id,
        member_id: newMember.uid,
      });

      // Send the new member data to the client
      res.status(201).json(newMember);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * PUT /committees/:id/members/:memberId
   */
  public async updateCommitteeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, memberId } = req.params;
    const startTime = logger.startOperation(req, 'update_committee_member', {
      committee_id: id,
      member_id: memberId,
      update_data: logger.sanitize(req.body),
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'update_committee_member',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Check if the member ID is provided
      if (!memberId) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('memberId', 'Member ID is required', {
          operation: 'update_committee_member',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Get the update data
      const updateData: Partial<CreateCommitteeMemberRequest> = req.body;

      // Update the committee member
      const updatedMember = await this.committeeService.updateCommitteeMember(req, id, memberId, updateData);

      // Log the success
      logger.success(req, 'update_committee_member', startTime, {
        committee_id: id,
        member_id: memberId,
      });

      // Send the updated member data to the client
      res.json(updatedMember);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /committees/:id/members/:memberId
   */
  public async deleteCommitteeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, memberId } = req.params;
    const startTime = logger.startOperation(req, 'delete_committee_member', {
      committee_id: id,
      member_id: memberId,
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'delete_committee_member',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Check if the member ID is provided
      if (!memberId) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('memberId', 'Member ID is required', {
          operation: 'delete_committee_member',
          service: 'committee_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Delete the committee member
      await this.committeeService.deleteCommitteeMember(req, id, memberId);

      // Log the success
      logger.success(req, 'delete_committee_member', startTime, {
        committee_id: id,
        member_id: memberId,
      });

      // Send the response to the client
      res.status(204).send();
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  // ── Document Endpoints ──────────────────────────────────────────────────

  /**
   * GET /committees/:id/documents
   */
  public async getCommitteeDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_committee_documents', {
      committee_id: id,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'get_committee_documents',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const documents = await this.committeeService.getCommitteeDocuments(req, id);

      logger.success(req, 'get_committee_documents', startTime, {
        committee_id: id,
        document_count: documents.length,
      });

      res.json(documents);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /committees/:id/documents
   */
  public async createCommitteeDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'create_committee_document', {
      committee_id: id,
      document_data: logger.sanitize(req.body),
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'create_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const data: CreateCommitteeDocumentRequest = req.body;

      // Always override created_by_name from OIDC session — never trust client-provided values
      data.created_by_name = (req.oidc?.user?.['name'] as string) || (req.oidc?.user?.['nickname'] as string) || '';

      // Validate required fields
      const validDocTypes = ['link', 'folder'];
      const fieldErrors: Record<string, string> = {};
      if (!data.name?.trim()) {
        fieldErrors['name'] = 'Document name is required';
      }
      if (!data.type) {
        fieldErrors['type'] = 'Document type is required';
      } else if (!validDocTypes.includes(data.type)) {
        fieldErrors['type'] = `Document type must be one of: ${validDocTypes.join(', ')}`;
      }
      if (data.type === 'link' && !data.url?.trim()) {
        fieldErrors['url'] = 'URL is required for link documents';
      }

      if (Object.keys(fieldErrors).length > 0) {
        const validationError = ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
          operation: 'create_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const newDocument = await this.committeeService.createCommitteeDocument(req, id, data);

      logger.success(req, 'create_committee_document', startTime, {
        committee_id: id,
        document_uid: newDocument.uid,
      });

      res.status(201).json(newDocument);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /committees/:id/documents/upload
   *
   * Receives a raw binary file body, forwards as multipart/form-data to the
   * committee service. Metadata passed as query params: name, file_name,
   * content_type, file_size, description?
   */
  public async uploadCommitteeDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    // Prevents type confusion via repeated query-string keys (e.g. file_size[]=1).
    const name = getStringQueryParam(req, 'name');
    const fileName = getStringQueryParam(req, 'file_name');
    const contentType = getStringQueryParam(req, 'content_type');
    const fileSize = getStringQueryParam(req, 'file_size');
    const description = getStringQueryParam(req, 'description');
    const folderUid = getStringQueryParam(req, 'folder_uid');

    const startTime = logger.startOperation(req, 'upload_committee_document', {
      committee_id: id,
      file_name: fileName,
      file_size: fileSize,
      content_type: contentType,
      folder_uid: folderUid,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'upload_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Trim before validating so whitespace-only strings fail the required-field check.
      const trimmedName = name?.trim();
      const trimmedFileName = fileName?.trim();

      const fieldErrors: Record<string, string> = {};
      if (!trimmedName) fieldErrors['name'] = 'Document name is required';
      if (!trimmedFileName) fieldErrors['file_name'] = 'File name is required';
      if (!contentType) fieldErrors['content_type'] = 'Content type is required';
      if (!fileSize) fieldErrors['file_size'] = 'File size is required';

      if (Object.keys(fieldErrors).length > 0) {
        const validationError = ServiceValidationError.fromFieldErrors(fieldErrors, 'Upload request validation failed', {
          operation: 'upload_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const fileBuffer = req.body as Buffer;
      const fileSizeNum = parseInt(fileSize!, 10);

      if (isNaN(fileSizeNum) || fileSizeNum <= 0) {
        const validationError = ServiceValidationError.forField('file_size', 'File size must be a positive number', {
          operation: 'upload_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        const validationError = ServiceValidationError.forField('body', 'Request body must contain file data', {
          operation: 'upload_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Reject if reported size doesn't match the actual body length.
      if (fileSizeNum !== fileBuffer.length) {
        const validationError = ServiceValidationError.forField(
          'file_size',
          `Reported file_size (${fileSizeNum}) does not match request body length (${fileBuffer.length})`,
          {
            operation: 'upload_committee_document',
            service: 'committee_controller',
            path: req.path,
          }
        );

        next(validationError);
        return;
      }

      // Server-side allowlist check — frontend allowlist can be bypassed by direct API calls.
      // Uses the same ALLOWED_FILE_TYPES + extension fallback as the file-upload component.
      if (!isFileTypeAllowed(contentType!, trimmedFileName!, ALLOWED_FILE_TYPES)) {
        next(
          ServiceValidationError.forField('content_type', `File type "${contentType}" is not allowed`, {
            operation: 'upload_committee_document',
            service: 'committee_controller',
            path: req.path,
          })
        );
        return;
      }

      // Reject path-traversal patterns in the filename so upstream can't be tricked into
      // writing or referencing files outside the committee scope. Frontend strips these
      // already; the server enforces the same rule for direct callers.
      if (/[/\\\0]/.test(trimmedFileName!) || trimmedFileName!.includes('..')) {
        next(
          ServiceValidationError.forField('file_name', 'File name contains invalid characters', {
            operation: 'upload_committee_document',
            service: 'committee_controller',
            path: req.path,
          })
        );
        return;
      }

      // Validate folder_uid shape so upstream can't be sent a malformed identifier.
      const trimmedFolderUid = folderUid?.trim();
      if (trimmedFolderUid && !FOLDER_UID_PATTERN.test(trimmedFolderUid)) {
        next(
          ServiceValidationError.forField('folder_uid', 'folder_uid must be a valid UUID', {
            operation: 'upload_committee_document',
            service: 'committee_controller',
            path: req.path,
          })
        );
        return;
      }

      const uploadData: UploadCommitteeDocumentRequest = {
        name: trimmedName!,
        file_name: trimmedFileName!,
        content_type: contentType!,
        file_size: fileSizeNum,
        ...(description && { description }),
        ...(trimmedFolderUid && { folder_uid: trimmedFolderUid }),
      };

      const result = await this.committeeService.uploadCommitteeDocument(req, id, fileBuffer, uploadData);

      logger.success(req, 'upload_committee_document', startTime, {
        committee_id: id,
        document_uid: result.uid,
        file_name: trimmedFileName,
        file_size: fileSizeNum,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /committees/:id/documents/:documentId/download
   *
   * Streams the file binary from the upstream committee service straight to the
   * browser with `Content-Disposition: attachment` (RFC 5987 encoded) so the
   * browser triggers a download without the BFF buffering the whole payload in
   * memory — important under concurrent downloads given the 100MB upload limit.
   */
  public async downloadCommitteeDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, documentId } = req.params;
    const startTime = logger.startOperation(req, 'download_committee_document', {
      committee_id: id,
      document_id: documentId,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'download_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!documentId) {
        const validationError = ServiceValidationError.forField('documentId', 'Document ID is required', {
          operation: 'download_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Fetch metadata and open the upstream stream in parallel.
      const [{ contentType, fileName }, upstream] = await Promise.all([
        this.committeeService.getCommitteeDocumentMetadata(req, id, documentId),
        this.committeeService.getCommitteeDocumentStream(req, id, documentId),
      ]);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', contentDispositionAttachment(fileName));
      const upstreamLength = upstream.headers.get('content-length');
      if (upstreamLength) {
        res.setHeader('Content-Length', upstreamLength);
      }

      // pipeline() propagates stream errors to the catch block instead of hanging.
      await pipeline(Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>), res);

      logger.success(req, 'download_committee_document', startTime, {
        committee_id: id,
        document_uid: documentId,
        file_name: fileName,
      });
    } catch (error) {
      // Headers already committed — can only end the stream.
      if (res.headersSent) {
        logger.error(req, 'download_committee_document', startTime, error, {
          committee_id: id,
          document_uid: documentId,
          stage: 'streaming',
        });
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }
      next(error);
    }
  }

  /**
   * DELETE /committees/:id/documents/:documentId?type=folder|link
   */
  public async deleteCommitteeDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, documentId } = req.params;
    const documentType = req.query['type'] as string;
    const validDeleteTypes = ['link', 'folder'];
    const startTime = logger.startOperation(req, 'delete_committee_document', {
      committee_id: id,
      document_id: documentId,
      document_type: documentType,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'delete_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!documentId) {
        const validationError = ServiceValidationError.forField('documentId', 'Document ID is required', {
          operation: 'delete_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!documentType || !validDeleteTypes.includes(documentType)) {
        const message = !documentType ? 'Document type query parameter is required' : `Document type must be one of: ${validDeleteTypes.join(', ')}`;
        const validationError = ServiceValidationError.forField('type', message, {
          operation: 'delete_committee_document',
          service: 'committee_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      await this.committeeService.deleteCommitteeDocument(req, id, documentId, documentType);

      logger.success(req, 'delete_committee_document', startTime, {
        committee_id: id,
        document_id: documentId,
        document_type: documentType,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // ── Sub-groups Endpoint ─────────────────────────────────────────────────

  /**
   * GET /committees/:id/children
   * Returns child committees (sub-groups) of a parent committee.
   */
  public async getCommitteeChildren(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_committee_children', { parent_id: id });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Committee ID is required', {
          operation: 'get_committee_children',
          service: 'committee_controller',
          path: req.path,
        });
        next(validationError);
        return;
      }

      // Use the query service's dedicated `parent` parameter for structured parent-child lookups.
      // Format: `committee:{uid}` — matches the `^[a-zA-Z]+:[a-zA-Z0-9_-]+$` pattern in the query service.
      const children = await this.committeeService.getCommittees(req, { ...req.query, parent: `committee:${id}` });

      if (children.length === 0) {
        logger.warning(req, 'get_committee_children', 'No child committees found', { parent_id: id });
      }

      logger.success(req, 'get_committee_children', startTime, {
        parent_id: id,
        children_count: children.length,
      });

      res.json(children);
    } catch (error) {
      next(error);
    }
  }

  // ── Join / Leave Endpoints ───────────────────────────────────────────────

  /**
   * POST /committees/:id/join
   * Self-join an open committee.
   */
  public async joinCommittee(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'join_committee', { committee_id: id });

    try {
      const member = await this.committeeService.joinCommittee(req, id);

      logger.success(req, 'join_committee', startTime, { committee_id: id });
      res.status(201).json(member);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /committees/:id/applications
   * Submit a join application for a committee with join_mode 'application'.
   */
  public async submitApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'submit_committee_application', { committee_id: id });

    try {
      const body = req.body as CreateCommitteeJoinApplicationRequest;
      const application = await this.committeeService.submitApplication(req, id, body);

      logger.success(req, 'submit_committee_application', startTime, { committee_id: id });
      res.status(201).json(application);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /committees/:id/leave
   */
  public async leaveCommittee(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'leave_committee', { committee_id: id });

    try {
      await this.committeeService.leaveCommittee(req, id);

      logger.success(req, 'leave_committee', startTime, { committee_id: id });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // ── Calendar ICS Endpoint ────────────────────────────────────────────────

  /**
   * GET /committees/:id/calendar.ics
   * Returns an iCalendar (.ics) file containing all meetings for the committee.
   * MeetingService is injected here rather than CommitteeService to avoid a
   * circular dependency (MeetingService already imports CommitteeService).
   */
  public async getCommitteeCalendar(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_committee_calendar', { committee_id: id });

    // Validate UID before using in query tags and Content-Disposition header
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
      next(ServiceValidationError.forField('id', 'Invalid committee ID', { operation: 'get_committee_calendar' }));
      return;
    }

    try {
      // When called from the public route there is no OIDC session, so use an
      // M2M token. When called from the authenticated route the user's bearer
      // token is already on req and no replacement is needed.
      if (!req.bearerToken) {
        req.bearerToken = await generateM2MToken(req);
      }

      const query = { tags: `committee_uid:${id}` };

      // Paginate both upcoming and past meetings — first page only would silently
      // drop meetings once a committee exceeds the default page size.
      const [upcoming, past] = await Promise.all([
        fetchAllMeetingPages((token) => this.meetingService.getMeetings(req, token ? { ...query, page_token: token } : query, 'v1_meeting', false)),
        fetchAllMeetingPages((token) => this.meetingService.getMeetings(req, token ? { ...query, page_token: token } : query, 'v1_past_meeting', false)),
      ]);

      const allMeetings = [...upcoming, ...past];
      const events = meetingsToVEvents(allMeetings);
      const ics = buildVCalendar(events);

      logger.success(req, 'get_committee_calendar', startTime, {
        committee_id: id,
        event_count: events.length,
      });

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="committee-${id}.ics"`);
      res.setHeader('Cache-Control', 'public, max-age=900'); // 15 minutes — reduces load from calendar clients polling every 15-60 minutes
      res.send(ics);
    } catch (error) {
      next(error);
    }
  }
}

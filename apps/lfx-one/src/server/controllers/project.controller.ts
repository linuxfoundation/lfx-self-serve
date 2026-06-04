// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ALLOWED_FILE_TYPES } from '@lfx-one/shared/constants';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import { AddUserToProjectRequest, CreateProjectDocumentRequest, UpdateUserRoleRequest, UploadProjectDocumentRequest } from '@lfx-one/shared/interfaces';
import { isFileTypeAllowed, isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { ServiceValidationError } from '../errors';
import { contentDispositionAttachment } from '../helpers/content-disposition.helper';
import { buildVCalendar, fetchAllMeetingPages, meetingsToVEvents } from '../helpers/ics.helper';
import { getStringQueryParam, validateUidParameter } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { MeetingService } from '../services/meeting.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveEmail } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';

const FOLDER_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Controller for handling project HTTP requests
 */
export class ProjectController {
  private projectService: ProjectService = new ProjectService();
  // Injected here (not on ProjectService) to avoid circular dependency — mirrors CommitteeController.
  private meetingService: MeetingService = new MeetingService();

  /**
   * GET /projects
   */
  public async getProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_projects', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const projects = await this.projectService.getProjects(req, req.query as Record<string, any>);

      logger.success(req, 'get_projects', startTime, {
        project_count: projects.length,
      });

      res.json(projects);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projects/search
   */
  public async searchProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { q } = req.query;
    const startTime = logger.startOperation(req, 'search_projects', {
      has_query: !!q,
    });

    try {
      // Check if the search query is provided and is a string
      if (!q || typeof q !== 'string') {
        // Create a validation error
        const validationError = ServiceValidationError.forField('q', 'Search query is required and must be a string', {
          operation: 'search_projects',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const results = await this.projectService.searchProjects(req, q);

      logger.success(req, 'search_projects', startTime, {
        result_count: results.length,
      });

      // Send the results to the client
      res.json(results);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projects/:slug
   */
  public async getProjectBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { slug } = req.params;
    const startTime = logger.startOperation(req, 'get_project_by_slug', {
      slug,
    });

    try {
      // Check if the project slug is provided
      if (!slug) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('slug', 'Project slug is required', {
          operation: 'get_project_by_slug',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Check if slug is a uuid
      if (isUuid(slug)) {
        // If the slug is a uuid, get the project by id
        const project = await this.projectService.getProjectById(req, slug);
        res.json(project);
        return;
      }

      // If the slug is not a uuid, get the project by slug
      const project = await this.projectService.getProjectBySlug(req, slug);

      // Log the success
      logger.success(req, 'get_project_by_slug', startTime, {
        slug,
        project_uid: project.uid,
      });

      // Send the project to the client
      res.json(project);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /projects/:uid/sfid — UUID → Salesforce 18-char ID translation via NATS.
   * Returns `{ sfid: string | null }`; null on lookup failure so callers can hide cleanly.
   * Project access is enforced via getProjectById before the NATS mapping (FGA on upstream).
   */
  public async getProjectSfid(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_project_sfid', { project_uid: uid });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_project_sfid',
          service: 'project_controller',
        })
      ) {
        return;
      }

      await this.projectService.getProjectById(req, uid, false);
      const sfid = await this.projectService.getProjectSfidByUid(req, uid);

      logger.success(req, 'get_project_sfid', startTime, {
        project_uid: uid,
        resolved: sfid != null,
      });

      res.json({ sfid });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projects/:uid/permissions
   */
  public async getProjectPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_project_permissions', {
      uid,
    });

    try {
      // Check if the project uid is provided
      if (!uid) {
        // Create a validation error
        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'get_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Get the project permissions
      const settings = await this.projectService.getProjectSettings(req, uid);

      // Log the success
      logger.success(req, 'get_project_permissions', startTime, {
        uid,
        project_uid: settings.uid,
      });

      // Send the permissions to the client
      res.json(settings);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /projects/:uid/permissions - Add user
   */
  public async addUserToProjectPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'add_user_project_permissions', {
      uid,
    });

    try {
      // Validate project uid
      if (!uid) {
        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'add_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const userData: AddUserToProjectRequest = req.body;

      // For the manual-add flow the frontend may omit username (users without a known
      // username are valid). Fall back to the email field as the routing identifier.
      const identifier = (userData.username || userData.email || '').trim();

      // Validate required fields — role is always required; at least one of username/email must be present
      if (!identifier || !userData.role) {
        const validationError = ServiceValidationError.forField('body', 'Username (or email) and role are required', {
          operation: 'add_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Validate role value
      if (!['view', 'manage'].includes(userData.role)) {
        const validationError = ServiceValidationError.forField('role', 'Role must be either "view" or "manage"', {
          operation: 'add_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Check if manual user data is provided (for users not found in directory).
      // name is always present for manual adds and never present for directory email lookups,
      // so it's the correct discriminator — using email alone would misclassify a plain
      // { email, role } directory-lookup request as a manual add.
      let manualUserInfo: { name: string; email: string; username?: string; avatar?: string } | undefined;
      if (userData.name) {
        manualUserInfo = {
          name: userData.name,
          email: userData.email || '',
          // username is optional for manually-added users — preserve whatever was provided
          username: userData.username || undefined,
        };
        if (userData.avatar) {
          manualUserInfo.avatar = userData.avatar;
        }
      }

      // Pass the identifier (username or email fallback) to updateProjectPermissions
      const result = await this.projectService.updateProjectPermissions(req, uid, 'add', identifier, userData.role, manualUserInfo);

      logger.success(req, 'add_user_project_permissions', startTime, {
        uid,
        identifier,
        role: userData.role,
        is_manual: !!manualUserInfo,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /projects/:uid/permissions/:username - Update user role
   */
  public async updateUserPermissionRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, username } = req.params;
    const startTime = logger.startOperation(req, 'update_user_role_project_permissions', {
      uid,
      username,
    });

    try {
      // Validate parameters
      if (!uid) {
        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!username) {
        const validationError = ServiceValidationError.forField('username', 'Username is required', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const roleData: UpdateUserRoleRequest = req.body;

      // Validate required fields
      if (!roleData.role) {
        const validationError = ServiceValidationError.forField('role', 'Role is required', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Validate role value
      if (!['view', 'manage'].includes(roleData.role)) {
        const validationError = ServiceValidationError.forField('role', 'Role must be either "view" or "manage"', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const result = await this.projectService.updateProjectPermissions(req, uid, 'update', username, roleData.role);

      logger.success(req, 'update_user_role_project_permissions', startTime, {
        uid,
        username,
        new_role: roleData.role,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /projects/:uid/permissions/:username - Remove user
   */
  public async removeUserFromProjectPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, username } = req.params;
    const startTime = logger.startOperation(req, 'remove_user_project_permissions', {
      uid,
      username,
    });

    try {
      // Validate parameters
      if (!uid) {
        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'remove_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!username) {
        const validationError = ServiceValidationError.forField('username', 'Username is required', {
          operation: 'remove_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      await this.projectService.updateProjectPermissions(req, uid, 'remove', username);

      logger.success(req, 'remove_user_project_permissions', startTime, {
        uid,
        username,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projects/pending-action-surveys - Get pending survey actions for the authenticated user
   */
  public async getPendingActionSurveys(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_pending_action_surveys');

    try {
      // Extract user email from auth context (impersonation-aware)
      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        const validationError = ServiceValidationError.forField('email', 'User email not found in authentication context', {
          operation: 'get_pending_action_surveys',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Extract projectSlug from query parameters
      const projectSlug = req.query['projectSlug'] as string | undefined;
      if (!projectSlug) {
        const validationError = ServiceValidationError.forField('projectSlug', 'projectSlug query parameter is required', {
          operation: 'get_pending_action_surveys',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Get pending surveys from service
      const pendingActions = await this.projectService.getPendingActionSurveys(userEmail, projectSlug);

      logger.success(req, 'get_pending_action_surveys', startTime, {
        project_slug: projectSlug,
        survey_count: pendingActions.length,
      });

      res.json(pendingActions);
    } catch (error) {
      next(error);
    }
  }

  // ── Document Endpoints ──────────────────────────────────────────────────

  /**
   * GET /projects/:uid/documents
   */
  public async getProjectDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_project_documents', {
      project_id: uid,
    });

    try {
      if (!uid) {
        next(
          ServiceValidationError.forField('uid', 'Project ID is required', {
            operation: 'get_project_documents',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      const documents = await this.projectService.getProjectDocuments(req, uid);

      logger.success(req, 'get_project_documents', startTime, {
        project_id: uid,
        document_count: documents.length,
      });

      res.json(documents);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /projects/:uid/documents
   * JSON body — folder or link only. File uploads use the /upload endpoint.
   */
  public async createProjectDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'create_project_document', {
      project_id: uid,
      document_data: logger.sanitize(req.body),
    });

    try {
      if (!uid) {
        next(
          ServiceValidationError.forField('uid', 'Project ID is required', {
            operation: 'create_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      // Reject null / array / primitive bodies before mutating — otherwise the
      // `data.created_by_name = ...` assignment below would 500 instead of returning a
      // typed validation error.
      if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
        next(
          ServiceValidationError.forField('body', 'Request body must be a JSON object', {
            operation: 'create_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      // Build a fresh object so we don't mutate `req.body`. Always override
      // `created_by_name` from the OIDC session — never trust client-provided values.
      const data: CreateProjectDocumentRequest = {
        ...(req.body as CreateProjectDocumentRequest),
        created_by_name: (req.oidc?.user?.['name'] as string) || (req.oidc?.user?.['nickname'] as string) || '',
      };

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
      // Validate parent_uid shape so upstream can't be sent a malformed identifier.
      // Mirrors the check in uploadProjectDocument (folder_uid query param).
      const trimmedParentUid = data.parent_uid?.trim();
      if (trimmedParentUid && !FOLDER_UID_PATTERN.test(trimmedParentUid)) {
        fieldErrors['parent_uid'] = 'parent_uid must be a valid UUID';
      }
      // Normalize back to the trimmed value so upstream receives the canonical UUID,
      // not whitespace-padded input. Empty/undefined stays untouched.
      data.parent_uid = trimmedParentUid || undefined;

      if (Object.keys(fieldErrors).length > 0) {
        next(
          ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
            operation: 'create_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      const newDocument = await this.projectService.createProjectDocument(req, uid, data);

      logger.success(req, 'create_project_document', startTime, {
        project_id: uid,
        document_uid: newDocument.uid,
      });

      res.status(201).json(newDocument);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /projects/:uid/documents/upload
   *
   * Receives a raw binary file body, forwards as multipart/form-data to the
   * project service. Metadata passed as query params: name, file_name,
   * content_type, file_size, description?, folder_uid?
   */
  public async uploadProjectDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    // Prevents type confusion via repeated query-string keys (e.g. file_size[]=1).
    const name = getStringQueryParam(req, 'name');
    const fileName = getStringQueryParam(req, 'file_name');
    const contentType = getStringQueryParam(req, 'content_type');
    const fileSize = getStringQueryParam(req, 'file_size');
    const description = getStringQueryParam(req, 'description');
    const folderUid = getStringQueryParam(req, 'folder_uid');

    const startTime = logger.startOperation(req, 'upload_project_document', {
      project_id: uid,
      file_name: fileName,
      file_size: fileSize,
      content_type: contentType,
      folder_uid: folderUid,
    });

    try {
      if (!uid) {
        next(
          ServiceValidationError.forField('uid', 'Project ID is required', {
            operation: 'upload_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
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
        next(
          ServiceValidationError.fromFieldErrors(fieldErrors, 'Upload request validation failed', {
            operation: 'upload_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      const fileBuffer = req.body as Buffer;
      const fileSizeNum = parseInt(fileSize!, 10);

      if (isNaN(fileSizeNum) || fileSizeNum <= 0) {
        next(
          ServiceValidationError.forField('file_size', 'File size must be a positive number', {
            operation: 'upload_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        next(
          ServiceValidationError.forField('body', 'Request body must contain file data', {
            operation: 'upload_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      // Reject if reported size doesn't match the actual body length.
      if (fileSizeNum !== fileBuffer.length) {
        next(
          ServiceValidationError.forField('file_size', `Reported file_size (${fileSizeNum}) does not match request body length (${fileBuffer.length})`, {
            operation: 'upload_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      // Server-side allowlist check — frontend allowlist can be bypassed by direct API calls.
      if (!isFileTypeAllowed(contentType!, trimmedFileName!, ALLOWED_FILE_TYPES)) {
        next(
          ServiceValidationError.forField('content_type', `File type "${contentType}" is not allowed`, {
            operation: 'upload_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      // Reject path-traversal patterns in the filename so upstream can't be tricked into
      // writing or referencing files outside the project scope.
      if (/[/\\\0]/.test(trimmedFileName!) || trimmedFileName!.includes('..')) {
        next(
          ServiceValidationError.forField('file_name', 'File name contains invalid characters', {
            operation: 'upload_project_document',
            service: 'project_controller',
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
            operation: 'upload_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      const uploadData: UploadProjectDocumentRequest = {
        name: trimmedName!,
        file_name: trimmedFileName!,
        content_type: contentType!,
        file_size: fileSizeNum,
        ...(description && { description }),
        ...(trimmedFolderUid && { folder_uid: trimmedFolderUid }),
      };

      const result = await this.projectService.uploadProjectDocument(req, uid, fileBuffer, uploadData);

      logger.success(req, 'upload_project_document', startTime, {
        project_id: uid,
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
   * GET /projects/:uid/documents/:documentId/download
   *
   * Streams the file binary from the upstream project service straight to the
   * browser with `Content-Disposition: attachment` (RFC 5987 encoded). The BFF
   * never buffers the whole payload — important under concurrent downloads given
   * the 100MB upload limit.
   */
  public async downloadProjectDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, documentId } = req.params;
    const startTime = logger.startOperation(req, 'download_project_document', {
      project_id: uid,
      document_id: documentId,
    });

    try {
      if (!uid) {
        next(
          ServiceValidationError.forField('uid', 'Project ID is required', {
            operation: 'download_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      if (!documentId) {
        next(
          ServiceValidationError.forField('documentId', 'Document ID is required', {
            operation: 'download_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      // Fetch metadata and open the upstream stream in parallel.
      const [{ contentType, fileName }, upstream] = await Promise.all([
        this.projectService.getProjectDocumentMetadata(req, uid, documentId),
        this.projectService.getProjectDocumentStream(req, uid, documentId),
      ]);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', contentDispositionAttachment(fileName));
      const upstreamLength = upstream.headers.get('content-length');
      if (upstreamLength) {
        res.setHeader('Content-Length', upstreamLength);
      }

      // pipeline() propagates stream errors to the catch block instead of hanging.
      await pipeline(Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>), res);

      logger.success(req, 'download_project_document', startTime, {
        project_id: uid,
        document_uid: documentId,
        file_name: fileName,
      });
    } catch (error) {
      // Headers already committed — can only end the stream.
      if (res.headersSent) {
        logger.error(req, 'download_project_document', startTime, error, {
          project_id: uid,
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
   * DELETE /projects/:uid/documents/:documentId?type=folder|link
   */
  public async deleteProjectDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, documentId } = req.params;
    // Use getStringQueryParam so repeated `?type=folder&type=link` keys can't slip through
    // as an array and bypass the validation below.
    const documentType = getStringQueryParam(req, 'type');
    const validDeleteTypes = ['link', 'folder'];
    const startTime = logger.startOperation(req, 'delete_project_document', {
      project_id: uid,
      document_id: documentId,
      document_type: documentType,
    });

    try {
      if (!uid) {
        next(
          ServiceValidationError.forField('uid', 'Project ID is required', {
            operation: 'delete_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      if (!documentId) {
        next(
          ServiceValidationError.forField('documentId', 'Document ID is required', {
            operation: 'delete_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      if (!documentType || !validDeleteTypes.includes(documentType)) {
        const message = !documentType ? 'Document type query parameter is required' : `Document type must be one of: ${validDeleteTypes.join(', ')}`;
        next(
          ServiceValidationError.forField('type', message, {
            operation: 'delete_project_document',
            service: 'project_controller',
            path: req.path,
          })
        );
        return;
      }

      await this.projectService.deleteProjectDocument(req, uid, documentId, documentType);

      logger.success(req, 'delete_project_document', startTime, {
        project_id: uid,
        document_id: documentId,
        document_type: documentType,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /** GET /public/api/projects/:id/calendar.ics — PUBLIC non-restricted meetings; serves both foundation and project lenses. */
  public async getProjectCalendar(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_project_calendar', { project_id: id });

    // Validate UID before using in query tags and Content-Disposition header
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
      next(ServiceValidationError.forField('id', 'Invalid project ID', { operation: 'get_project_calendar' }));
      return;
    }

    try {
      // Public route has no session — obtain M2M token so meeting service calls succeed.
      if (!req.bearerToken) {
        req.bearerToken = await generateM2MToken(req);
      }

      const query = { tags: `project_uid:${id}` };

      // Fetch all pages — first-page-only would silently drop meetings beyond the default page size.
      const [upcoming, past] = await Promise.all([
        fetchAllMeetingPages((token) => this.meetingService.getMeetings(req, token ? { ...query, page_token: token } : query, 'v1_meeting', false)),
        fetchAllMeetingPages((token) => this.meetingService.getMeetings(req, token ? { ...query, page_token: token } : query, 'v1_past_meeting', false)),
      ]);

      // Filter PRIVATE/restricted meetings from the public feed (mirrors PublicMeetingController visibility guard).
      const allMeetings = [...upcoming, ...past].filter((m) => m.visibility === MeetingVisibility.PUBLIC && !m.restricted);
      const events = meetingsToVEvents(allMeetings);
      const ics = buildVCalendar(events, '-//LFX//Project Calendar//EN');

      logger.success(req, 'get_project_calendar', startTime, {
        project_id: id,
        event_count: events.length,
        filtered_out: upcoming.length + past.length - allMeetings.length,
      });

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="project-${id}.ics"`);
      res.setHeader('Cache-Control', 'public, max-age=900'); // 15 minutes — reduces load from calendar clients polling every 15-60 minutes
      res.send(ics);
    } catch (error) {
      next(error);
    }
  }
}

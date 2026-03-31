// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeCreateData, CommitteeUpdateData, CreateCommitteeDocumentRequest, CreateCommitteeMemberRequest, CreateCommitteeJoinApplicationRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { CommitteeService } from '../services/committee.service';

/**
 * Controller for handling committee HTTP requests
 */
export class CommitteeController {
  private committeeService: CommitteeService = new CommitteeService();

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
    const startTime = logger.startOperation(req, 'get_my_committees', { project_uid: projectUid });

    try {
      const myCommittees = await this.committeeService.getMyCommittees(req, projectUid);

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

      // Get the committee by ID
      const committee = await this.committeeService.getCommitteeById(req, id);

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

      logger.success(req, 'get_committee_children', startTime, {
        parent_id: id,
        children_count: children.length,
      });

      res.json(children);
    } catch (error) {
      logger.error(req, 'get_committee_children', startTime, error, { parent_id: id });
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
      logger.error(req, 'get_committee_documents', startTime, error, { committee_id: id });
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
      logger.error(req, 'create_committee_document', startTime, error, { committee_id: id });
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
      logger.error(req, 'delete_committee_document', startTime, error, { committee_id: id, document_id: documentId });
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
      logger.error(req, 'submit_committee_application', startTime, error, { committee_id: id });
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
}

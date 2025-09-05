// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeCreateData, CommitteeUpdateData, CreateCommitteeMemberRequest } from '@lfx-pcc/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { Logger } from '../helpers/logger';
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
    const startTime = Logger.start(req, 'get_committees', {
      query_params: Logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const committees = await this.committeeService.getCommittees(req, req.query);

      Logger.success(req, 'get_committees', startTime, {
        committee_count: committees.length,
      });

      res.json(committees);
    } catch (error) {
      Logger.error(req, 'get_committees', startTime, error);
      next(error);
    }
  }

  /**
   * GET /committees/:id
   */
  public async getCommitteeById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'get_committee_by_id', {
      committee_id: id,
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        // Log the error
        Logger.error(req, 'get_committee_by_id', startTime, new Error('Missing committee ID parameter'));

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
      Logger.success(req, 'get_committee_by_id', startTime, {
        committee_id: id,
        committee_category: committee.category,
      });

      // Send the committee data to the client
      res.json(committee);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_committee_by_id', startTime, error, {
        committee_id: id,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /committees
   */
  public async createCommittee(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'create_committee', {
      committee_data: Logger.sanitize(req.body),
    });

    try {
      const committeeData: CommitteeCreateData = req.body;
      // Create the committee
      const newCommittee = await this.committeeService.createCommittee(req, committeeData);

      // Log the success
      Logger.success(req, 'create_committee', startTime, {
        committee_id: newCommittee.uid,
        committee_category: newCommittee.category,
      });

      // Send the new committee data to the client
      res.status(201).json(newCommittee);
    } catch (error) {
      // Log the error
      Logger.error(req, 'create_committee', startTime, error);

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * PUT /committees/:id
   */
  public async updateCommittee(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'update_committee', {
      committee_id: id,
      update_data: Logger.sanitize(req.body),
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        Logger.error(req, 'update_committee', startTime, new Error('Missing committee ID parameter'));

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
      Logger.success(req, 'update_committee', startTime, {
        committee_id: id,
      });

      // Send the updated committee data to the client
      res.json(updatedCommittee);
    } catch (error) {
      Logger.error(req, 'update_committee', startTime, error, {
        committee_id: id,
      });
      next(error);
    }
  }

  /**
   * DELETE /committees/:id
   */
  public async deleteCommittee(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'delete_committee', {
      committee_id: id,
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        Logger.error(req, 'delete_committee', startTime, new Error('Missing committee ID parameter'));

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
      Logger.success(req, 'delete_committee', startTime, {
        committee_id: id,
      });

      // Send the response to the client
      res.status(204).send();
    } catch (error) {
      // Log the error
      Logger.error(req, 'delete_committee', startTime, error, {
        committee_id: id,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /committees/:id/members
   */
  public async getCommitteeMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'get_committee_members', {
      committee_id: id,
      query_params: Logger.sanitize(req.query as Record<string, any>),
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        Logger.error(req, 'get_committee_members', startTime, new Error('Missing committee ID parameter'));

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
      Logger.success(req, 'get_committee_members', startTime, {
        committee_id: id,
        member_count: members.length,
      });

      // Send the members data to the client
      res.json(members);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_committee_members', startTime, error, {
        committee_id: id,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /committees/:id/members/:memberId
   */
  public async getCommitteeMemberById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, memberId } = req.params;
    const startTime = Logger.start(req, 'get_committee_member_by_id', {
      committee_id: id,
      member_id: memberId,
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        Logger.error(req, 'get_committee_member_by_id', startTime, new Error('Missing committee ID parameter'));

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
        Logger.error(req, 'get_committee_member_by_id', startTime, new Error('Missing member ID parameter'));

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
      Logger.success(req, 'get_committee_member_by_id', startTime, {
        committee_id: id,
        member_id: memberId,
      });

      // Send the member data to the client
      res.json(member);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_committee_member_by_id', startTime, error, {
        committee_id: id,
        member_id: memberId,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /committees/:id/members
   */
  public async createCommitteeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'create_committee_member', {
      committee_id: id,
      member_data: Logger.sanitize(req.body),
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        Logger.error(req, 'create_committee_member', startTime, new Error('Missing committee ID parameter'));

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
      Logger.success(req, 'create_committee_member', startTime, {
        committee_id: id,
        member_id: newMember.uid,
      });

      // Send the new member data to the client
      res.status(201).json(newMember);
    } catch (error) {
      // Log the error
      Logger.error(req, 'create_committee_member', startTime, error, {
        committee_id: id,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * PUT /committees/:id/members/:memberId
   */
  public async updateCommitteeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, memberId } = req.params;
    const startTime = Logger.start(req, 'update_committee_member', {
      committee_id: id,
      member_id: memberId,
      update_data: Logger.sanitize(req.body),
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        Logger.error(req, 'update_committee_member', startTime, new Error('Missing committee ID parameter'));

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
        Logger.error(req, 'update_committee_member', startTime, new Error('Missing member ID parameter'));

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
      Logger.success(req, 'update_committee_member', startTime, {
        committee_id: id,
        member_id: memberId,
      });

      // Send the updated member data to the client
      res.json(updatedMember);
    } catch (error) {
      // Log the error
      Logger.error(req, 'update_committee_member', startTime, error, {
        committee_id: id,
        member_id: memberId,
      });
      next(error);
    }
  }

  /**
   * DELETE /committees/:id/members/:memberId
   */
  public async deleteCommitteeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, memberId } = req.params;
    const startTime = Logger.start(req, 'delete_committee_member', {
      committee_id: id,
      member_id: memberId,
    });

    try {
      // Check if the committee ID is provided
      if (!id) {
        Logger.error(req, 'delete_committee_member', startTime, new Error('Missing committee ID parameter'));

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
        Logger.error(req, 'delete_committee_member', startTime, new Error('Missing member ID parameter'));

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
      Logger.success(req, 'delete_committee_member', startTime, {
        committee_id: id,
        member_id: memberId,
      });

      // Send the response to the client
      res.status(204).send();
    } catch (error) {
      // Log the error
      Logger.error(req, 'delete_committee_member', startTime, error, {
        committee_id: id,
        member_id: memberId,
      });

      // Send the error to the next middleware
      next(error);
    }
  }
}

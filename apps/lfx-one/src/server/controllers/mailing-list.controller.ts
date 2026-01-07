// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CreateGroupsIOServiceRequest,
  CreateMailingListMemberRequest,
  CreateMailingListRequest,
  UpdateGroupsIOServiceRequest,
  UpdateMailingListMemberRequest,
} from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MailingListService } from '../services/mailing-list.service';

/**
 * Controller for handling mailing list HTTP requests
 */
export class MailingListController {
  private mailingListService: MailingListService = new MailingListService();

  // ============================================
  // Groups.io Service Endpoints
  // ============================================

  /**
   * GET /mailing-lists/services
   */
  public async getServices(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_groupsio_services', {
      query_params: logger.sanitize(req.query as Record<string, unknown>),
    });

    try {
      const services = await this.mailingListService.getServices(req, req.query);

      logger.success(req, 'get_groupsio_services', startTime, {
        service_count: services.length,
      });

      res.json(services);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /mailing-lists/services/count
   */
  public async getServicesCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_groupsio_services_count', {
      query_params: logger.sanitize(req.query as Record<string, unknown>),
    });

    try {
      const count = await this.mailingListService.getServicesCount(req, req.query);

      logger.success(req, 'get_groupsio_services_count', startTime, {
        count,
      });

      res.json({ count });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /mailing-lists/services/:id
   */
  public async getServiceById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_groupsio_service_by_id', {
      service_id: id,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Service ID is required', {
          operation: 'get_groupsio_service_by_id',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const service = await this.mailingListService.getServiceById(req, id);

      logger.success(req, 'get_groupsio_service_by_id', startTime, {
        service_id: id,
        service_type: service.type,
      });

      res.json(service);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /mailing-lists/services
   */
  public async createService(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'create_groupsio_service', {
      service_data: logger.sanitize(req.body),
    });

    try {
      const serviceData: CreateGroupsIOServiceRequest = req.body;
      const newService = await this.mailingListService.createService(req, serviceData);

      logger.success(req, 'create_groupsio_service', startTime, {
        service_id: newService.uid,
        service_type: newService.type,
      });

      res.status(201).json(newService);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /mailing-lists/services/:id
   */
  public async updateService(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'update_groupsio_service', {
      service_id: id,
      update_data: logger.sanitize(req.body),
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Service ID is required', {
          operation: 'update_groupsio_service',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const updateData: UpdateGroupsIOServiceRequest = req.body;
      const updatedService = await this.mailingListService.updateService(req, id, updateData);

      logger.success(req, 'update_groupsio_service', startTime, {
        service_id: id,
      });

      res.json(updatedService);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /mailing-lists/services/:id
   */
  public async deleteService(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'delete_groupsio_service', {
      service_id: id,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Service ID is required', {
          operation: 'delete_groupsio_service',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      await this.mailingListService.deleteService(req, id);

      logger.success(req, 'delete_groupsio_service', startTime, {
        service_id: id,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // ============================================
  // Mailing List Endpoints
  // ============================================

  /**
   * GET /mailing-lists
   */
  public async getMailingLists(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mailing_lists', {
      query_params: logger.sanitize(req.query as Record<string, unknown>),
    });

    try {
      const mailingLists = await this.mailingListService.getMailingLists(req, req.query);

      logger.success(req, 'get_mailing_lists', startTime, {
        mailing_list_count: mailingLists.length,
      });

      res.json(mailingLists);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /mailing-lists/count
   */
  public async getMailingListsCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mailing_lists_count', {
      query_params: logger.sanitize(req.query as Record<string, unknown>),
    });

    try {
      const count = await this.mailingListService.getMailingListsCount(req, req.query);

      logger.success(req, 'get_mailing_lists_count', startTime, {
        count,
      });

      res.json({ count });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /mailing-lists/:id
   */
  public async getMailingListById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_mailing_list_by_id', {
      mailing_list_id: id,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Mailing List ID is required', {
          operation: 'get_mailing_list_by_id',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const mailingList = await this.mailingListService.getMailingListById(req, id);

      logger.success(req, 'get_mailing_list_by_id', startTime, {
        mailing_list_id: id,
        mailing_list_type: mailingList.type,
      });

      res.json(mailingList);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /mailing-lists
   */
  public async createMailingList(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'create_mailing_list', {
      mailing_list_data: logger.sanitize(req.body),
    });

    try {
      const mailingListData: CreateMailingListRequest = req.body;
      const newMailingList = await this.mailingListService.createMailingList(req, mailingListData);

      logger.success(req, 'create_mailing_list', startTime, {
        mailing_list_uid: newMailingList.uid,
        mailing_list_type: newMailingList.type,
      });

      res.status(201).json(newMailingList);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /mailing-lists/:id
   */
  public async updateMailingList(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'update_mailing_list', {
      mailing_list_id: id,
      update_data: logger.sanitize(req.body),
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Mailing List ID is required', {
          operation: 'update_mailing_list',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const updateData: Partial<CreateMailingListRequest> = req.body;
      const updatedMailingList = await this.mailingListService.updateMailingList(req, id, updateData);

      logger.success(req, 'update_mailing_list', startTime, {
        mailing_list_id: id,
      });

      res.json(updatedMailingList);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /mailing-lists/:id
   */
  public async deleteMailingList(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'delete_mailing_list', {
      mailing_list_id: id,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Mailing List ID is required', {
          operation: 'delete_mailing_list',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      await this.mailingListService.deleteMailingList(req, id);

      logger.success(req, 'delete_mailing_list', startTime, {
        mailing_list_id: id,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // ============================================
  // Mailing List Member Endpoints
  // ============================================

  /**
   * GET /mailing-lists/:id/members
   */
  public async getMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_mailing_list_members', {
      mailing_list_id: id,
      query_params: logger.sanitize(req.query as Record<string, unknown>),
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Mailing List ID is required', {
          operation: 'get_mailing_list_members',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const members = await this.mailingListService.getMembers(req, id, req.query);

      logger.success(req, 'get_mailing_list_members', startTime, {
        mailing_list_id: id,
        member_count: members.length,
      });

      res.json(members);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /mailing-lists/:id/members/count
   */
  public async getMembersCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'get_mailing_list_members_count', {
      mailing_list_id: id,
      query_params: logger.sanitize(req.query as Record<string, unknown>),
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Mailing List ID is required', {
          operation: 'get_mailing_list_members_count',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const count = await this.mailingListService.getMembersCount(req, id, req.query);

      logger.success(req, 'get_mailing_list_members_count', startTime, {
        mailing_list_id: id,
        count,
      });

      res.json({ count });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /mailing-lists/:id/members/:memberId
   */
  public async getMemberById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, memberId } = req.params;
    const startTime = logger.startOperation(req, 'get_mailing_list_member_by_id', {
      mailing_list_id: id,
      member_id: memberId,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Mailing List ID is required', {
          operation: 'get_mailing_list_member_by_id',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!memberId) {
        const validationError = ServiceValidationError.forField('memberId', 'Member ID is required', {
          operation: 'get_mailing_list_member_by_id',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const member = await this.mailingListService.getMemberById(req, id, memberId);

      logger.success(req, 'get_mailing_list_member_by_id', startTime, {
        mailing_list_id: id,
        member_id: memberId,
      });

      res.json(member);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /mailing-lists/:id/members
   */
  public async createMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = logger.startOperation(req, 'create_mailing_list_member', {
      mailing_list_id: id,
      member_data: logger.sanitize(req.body),
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Mailing List ID is required', {
          operation: 'create_mailing_list_member',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const memberData: CreateMailingListMemberRequest = req.body;
      const newMember = await this.mailingListService.createMember(req, id, memberData);

      logger.success(req, 'create_mailing_list_member', startTime, {
        mailing_list_id: id,
        member_id: newMember.uid,
      });

      res.status(201).json(newMember);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /mailing-lists/:id/members/:memberId
   */
  public async updateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, memberId } = req.params;
    const startTime = logger.startOperation(req, 'update_mailing_list_member', {
      mailing_list_id: id,
      member_id: memberId,
      update_data: logger.sanitize(req.body),
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Mailing List ID is required', {
          operation: 'update_mailing_list_member',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!memberId) {
        const validationError = ServiceValidationError.forField('memberId', 'Member ID is required', {
          operation: 'update_mailing_list_member',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const updateData: UpdateMailingListMemberRequest = req.body;
      const updatedMember = await this.mailingListService.updateMember(req, id, memberId, updateData);

      logger.success(req, 'update_mailing_list_member', startTime, {
        mailing_list_id: id,
        member_id: memberId,
      });

      res.json(updatedMember);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /mailing-lists/:id/members/:memberId
   */
  public async deleteMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id, memberId } = req.params;
    const startTime = logger.startOperation(req, 'delete_mailing_list_member', {
      mailing_list_id: id,
      member_id: memberId,
    });

    try {
      if (!id) {
        const validationError = ServiceValidationError.forField('id', 'Mailing List ID is required', {
          operation: 'delete_mailing_list_member',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!memberId) {
        const validationError = ServiceValidationError.forField('memberId', 'Member ID is required', {
          operation: 'delete_mailing_list_member',
          service: 'mailing_list_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      await this.mailingListService.deleteMember(req, id, memberId);

      logger.success(req, 'delete_mailing_list_member', startTime, {
        mailing_list_id: id,
        member_id: memberId,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

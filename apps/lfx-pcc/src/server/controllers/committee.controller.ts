// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request, Response } from 'express';
import { CommitteeCreateData, CommitteeUpdateData } from '@lfx-pcc/shared/interfaces';

import { CommitteeService } from '../services/committee.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { Logger } from '../helpers/logger';
import { Responder } from '../helpers/responder';

/**
 * Controller for handling committee HTTP requests
 */
export class CommitteeController {
  private committeeService: CommitteeService;

  public constructor(private microserviceProxy: MicroserviceProxyService) {
    this.committeeService = new CommitteeService(microserviceProxy);
  }

  /**
   * GET /committees
   */
  public async getCommittees(req: Request, res: Response): Promise<void> {
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
      Responder.handle(res, error, 'get_committees');
    }
  }

  /**
   * GET /committees/:id
   */
  public async getCommitteeById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'get_committee_by_id', {
      committee_id: id,
    });

    try {
      const committee = await this.committeeService.getCommitteeById(req, id);

      Logger.success(req, 'get_committee_by_id', startTime, {
        committee_id: id,
        committee_category: committee.category,
      });

      res.json(committee);
    } catch (error) {
      Logger.error(req, 'get_committee_by_id', startTime, error, {
        committee_id: id,
      });
      Responder.handle(res, error, 'get_committee_by_id');
    }
  }

  /**
   * POST /committees
   */
  public async createCommittee(req: Request, res: Response): Promise<void> {
    const startTime = Logger.start(req, 'create_committee', {
      committee_data: Logger.sanitize(req.body),
    });

    try {
      const committeeData: CommitteeCreateData = req.body;
      const newCommittee = await this.committeeService.createCommittee(req, committeeData);

      Logger.success(req, 'create_committee', startTime, {
        committee_id: newCommittee.uid,
        committee_category: newCommittee.category,
      });

      res.status(201).json(newCommittee);
    } catch (error) {
      Logger.error(req, 'create_committee', startTime, error);
      Responder.handle(res, error, 'create_committee');
    }
  }

  /**
   * PUT /committees/:id
   */
  public async updateCommittee(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'update_committee', {
      committee_id: id,
      update_data: Logger.sanitize(req.body),
    });

    try {
      const updateData: CommitteeUpdateData = req.body;
      const updatedCommittee = await this.committeeService.updateCommittee(req, id, updateData);

      Logger.success(req, 'update_committee', startTime, {
        committee_id: id,
      });

      res.json(updatedCommittee);
    } catch (error) {
      Logger.error(req, 'update_committee', startTime, error, {
        committee_id: id,
      });
      Responder.handle(res, error, 'update_committee');
    }
  }

  /**
   * DELETE /committees/:id
   */
  public async deleteCommittee(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'delete_committee', {
      committee_id: id,
    });

    try {
      await this.committeeService.deleteCommittee(req, id);

      Logger.success(req, 'delete_committee', startTime, {
        committee_id: id,
      });

      res.status(204).send();
    } catch (error) {
      Logger.error(req, 'delete_committee', startTime, error, {
        committee_id: id,
      });
      Responder.handle(res, error, 'delete_committee');
    }
  }
}

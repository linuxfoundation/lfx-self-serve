// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response, Router } from 'express';

import { ApiClientService } from '../services/api-client.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { SupabaseService } from '../services/supabase.service';
import { CommitteeController } from '../controllers/committee.controller';

const router = Router();

const supabaseService = new SupabaseService();
const microserviceProxyService = new MicroserviceProxyService(new ApiClientService());
const committeeController = new CommitteeController(microserviceProxyService);

// Committee CRUD routes - using new controller pattern
router.get('/', (req, res) => committeeController.getCommittees(req, res));
router.get('/:id', (req, res) => committeeController.getCommitteeById(req, res));
router.post('/', (req, res) => committeeController.createCommittee(req, res));
router.put('/:id', (req, res) => committeeController.updateCommittee(req, res));
router.delete('/:id', (req, res) => committeeController.deleteCommittee(req, res));

// Committee member routes - still using Supabase service (not migrated to v2 yet)
router.get('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committeeId = req.params['id'];

    if (!committeeId) {
      return res.status(400).json({
        error: 'Committee ID is required',
        code: 'MISSING_COMMITTEE_ID',
      });
    }

    // Verify committee exists
    const committee = await supabaseService.getCommitteeById(committeeId);
    if (!committee) {
      return res.status(404).json({
        error: 'Committee not found',
        code: 'COMMITTEE_NOT_FOUND',
      });
    }

    const members = await supabaseService.getCommitteeMembers(committeeId, req.query as Record<string, any>);

    return res.json(members);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        committee_id: req.params['id'],
      },
      'Failed to fetch committee members'
    );
    return next(error);
  }
});

router.get('/:id/members/:memberId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committeeId = req.params['id'];
    const memberId = req.params['memberId'];

    if (!committeeId) {
      return res.status(400).json({
        error: 'Committee ID is required',
        code: 'MISSING_COMMITTEE_ID',
      });
    }

    if (!memberId) {
      return res.status(400).json({
        error: 'Member ID is required',
        code: 'MISSING_MEMBER_ID',
      });
    }

    // Verify committee exists
    const committee = await supabaseService.getCommitteeById(committeeId);
    if (!committee) {
      return res.status(404).json({
        error: 'Committee not found',
        code: 'COMMITTEE_NOT_FOUND',
      });
    }

    const member = await supabaseService.getCommitteeMemberById(committeeId, memberId);

    if (!member) {
      return res.status(404).json({
        error: 'Member not found',
        code: 'MEMBER_NOT_FOUND',
      });
    }

    return res.json(member);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        committee_id: req.params['id'],
        member_id: req.params['memberId'],
      },
      'Failed to fetch committee member'
    );
    return next(error);
  }
});

router.post('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committeeId = req.params['id'];
    const memberData = req.body;

    if (!committeeId) {
      return res.status(400).json({
        error: 'Committee ID is required',
        code: 'MISSING_COMMITTEE_ID',
      });
    }

    // Verify committee exists
    const committee = await supabaseService.getCommitteeById(committeeId);
    if (!committee) {
      return res.status(404).json({
        error: 'Committee not found',
        code: 'COMMITTEE_NOT_FOUND',
      });
    }

    // Basic validation
    if (!memberData?.email) {
      return res.status(400).json({
        error: 'Member email is required',
        code: 'MISSING_MEMBER_EMAIL',
      });
    }

    if (!memberData?.first_name && !memberData?.last_name) {
      return res.status(400).json({
        error: 'Member first name or last name is required',
        code: 'MISSING_MEMBER_NAME',
      });
    }

    const newMember = await supabaseService.addCommitteeMember(committeeId, memberData);

    return res.status(201).json(newMember);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        committee_id: req.params['id'],
      },
      'Failed to add committee member'
    );
    return next(error);
  }
});

router.put('/:id/members/:memberId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committeeId = req.params['id'];
    const memberId = req.params['memberId'];
    const memberData = req.body;

    if (!committeeId) {
      return res.status(400).json({
        error: 'Committee ID is required',
        code: 'MISSING_COMMITTEE_ID',
      });
    }

    if (!memberId) {
      return res.status(400).json({
        error: 'Member ID is required',
        code: 'MISSING_MEMBER_ID',
      });
    }

    // Verify committee exists
    const committee = await supabaseService.getCommitteeById(committeeId);
    if (!committee) {
      return res.status(404).json({
        error: 'Committee not found',
        code: 'COMMITTEE_NOT_FOUND',
      });
    }

    // Check if member exists before attempting to update
    const existingMember = await supabaseService.getCommitteeMemberById(committeeId, memberId);
    if (!existingMember) {
      return res.status(404).json({
        error: 'Member not found',
        code: 'MEMBER_NOT_FOUND',
      });
    }

    const updatedMember = await supabaseService.updateCommitteeMember(committeeId, memberId, memberData);

    return res.json(updatedMember);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        committee_id: req.params['id'],
        member_id: req.params['memberId'],
      },
      'Failed to update committee member'
    );
    return next(error);
  }
});

router.delete('/:id/members/:memberId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committeeId = req.params['id'];
    const memberId = req.params['memberId'];

    if (!committeeId) {
      return res.status(400).json({
        error: 'Committee ID is required',
        code: 'MISSING_COMMITTEE_ID',
      });
    }

    if (!memberId) {
      return res.status(400).json({
        error: 'Member ID is required',
        code: 'MISSING_MEMBER_ID',
      });
    }

    // Verify committee exists
    const committee = await supabaseService.getCommitteeById(committeeId);
    if (!committee) {
      return res.status(404).json({
        error: 'Committee not found',
        code: 'COMMITTEE_NOT_FOUND',
      });
    }

    // Check if member exists before attempting to delete
    const existingMember = await supabaseService.getCommitteeMemberById(committeeId, memberId);
    if (!existingMember) {
      return res.status(404).json({
        error: 'Member not found',
        code: 'MEMBER_NOT_FOUND',
      });
    }

    await supabaseService.removeCommitteeMember(committeeId, memberId);

    return res.status(204).send();
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        committee_id: req.params['id'],
        member_id: req.params['memberId'],
      },
      'Failed to remove committee member'
    );
    return next(error);
  }
});

export default router;

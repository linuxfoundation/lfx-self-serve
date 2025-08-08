// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response, Router } from 'express';

import { SupabaseService } from '../services/supabase.service';

const router = Router();

const supabaseService = new SupabaseService();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  req.log.info(
    {
      operation: 'fetch_committees',
      query_params: req.query,
    },
    'Starting committees fetch request'
  );

  try {
    const committees = await supabaseService.getCommittees(req.query as Record<string, any>);
    const duration = Date.now() - startTime;

    req.log.info(
      {
        operation: 'fetch_committees',
        committee_count: committees.length,
        duration,
        status_code: 200,
      },
      'Successfully fetched committees'
    );

    return res.json(committees);
  } catch (error) {
    const duration = Date.now() - startTime;
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        operation: 'fetch_committees',
        duration,
        query_params: req.query,
      },
      'Failed to fetch committees'
    );
    return next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const committeeId = req.params['id'];

  req.log.info(
    {
      operation: 'fetch_committee_by_id',
      committee_id: committeeId,
    },
    'Starting committee fetch by ID request'
  );

  try {
    if (!committeeId) {
      req.log.warn(
        {
          operation: 'fetch_committee_by_id',
          error: 'Missing committee ID parameter',
          status_code: 400,
        },
        'Bad request: Committee ID validation failed'
      );

      return res.status(400).json({
        error: 'Committee ID is required',
        code: 'MISSING_COMMITTEE_ID',
      });
    }

    const committee = await supabaseService.getCommitteeById(committeeId);

    if (!committee) {
      const duration = Date.now() - startTime;
      req.log.warn(
        {
          operation: 'fetch_committee_by_id',
          committee_id: committeeId,
          error: 'Committee not found',
          duration,
          status_code: 404,
        },
        'Committee not found'
      );

      return res.status(404).json({
        error: 'Committee not found',
        code: 'COMMITTEE_NOT_FOUND',
      });
    }

    const duration = Date.now() - startTime;
    req.log.info(
      {
        operation: 'fetch_committee_by_id',
        committee_id: committeeId,
        duration,
        status_code: 200,
      },
      'Successfully fetched committee'
    );

    return res.json(committee);
  } catch (error) {
    const duration = Date.now() - startTime;
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        operation: 'fetch_committee_by_id',
        committee_id: committeeId,
        duration,
      },
      'Failed to fetch committee'
    );
    return next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const committeeData = req.body;

  req.log.info(
    {
      operation: 'create_committee',
      committee_category: committeeData?.category,
      body_size: JSON.stringify(req.body).length,
    },
    'Starting committee creation request'
  );

  try {
    if (!committeeData?.name) {
      req.log.warn(
        {
          operation: 'create_committee',
          error: 'Missing committee name',
          provided_data: { has_name: !!committeeData?.name, has_category: !!committeeData?.category },
          status_code: 400,
        },
        'Bad request: Committee name validation failed'
      );

      return res.status(400).json({
        error: 'Committee name is required',
        code: 'MISSING_COMMITTEE_NAME',
      });
    }

    if (!committeeData?.category) {
      req.log.warn(
        {
          operation: 'create_committee',
          error: 'Missing committee category',
          provided_data: { has_name: !!committeeData?.name, has_category: !!committeeData?.category },
          status_code: 400,
        },
        'Bad request: Committee category validation failed'
      );

      return res.status(400).json({
        error: 'Committee category is required',
        code: 'MISSING_COMMITTEE_CATEGORY',
      });
    }

    const newCommittee = await supabaseService.createCommittee(committeeData);
    const duration = Date.now() - startTime;

    req.log.info(
      {
        operation: 'create_committee',
        committee_id: newCommittee.id,
        committee_category: newCommittee.category,
        duration,
        status_code: 201,
      },
      'Successfully created committee'
    );

    return res.status(201).json(newCommittee);
  } catch (error) {
    const duration = Date.now() - startTime;
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        operation: 'create_committee',
        committee_category: req.body?.category,
        duration,
      },
      'Failed to create committee'
    );
    return next(error);
  }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committeeId = req.params['id'];
    const committeeData = req.body;

    if (!committeeId) {
      return res.status(400).json({
        error: 'Committee ID is required',
        code: 'MISSING_COMMITTEE_ID',
      });
    }

    // Check if committee exists before attempting to update
    const existingCommittee = await supabaseService.getCommitteeById(committeeId);
    if (!existingCommittee) {
      return res.status(404).json({
        error: 'Committee not found',
        code: 'COMMITTEE_NOT_FOUND',
      });
    }

    const updatedCommittee = await supabaseService.updateCommittee(committeeId, committeeData);

    return res.json(updatedCommittee);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        committee_id: req.params['id'],
      },
      'Failed to update committee'
    );
    return next(error);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committeeId = req.params['id'];

    if (!committeeId) {
      return res.status(400).json({
        error: 'Committee ID is required',
        code: 'MISSING_COMMITTEE_ID',
      });
    }

    // Check if committee exists before attempting to delete
    const existingCommittee = await supabaseService.getCommitteeById(committeeId);
    if (!existingCommittee) {
      return res.status(404).json({
        error: 'Committee not found',
        code: 'COMMITTEE_NOT_FOUND',
      });
    }

    await supabaseService.deleteCommittee(committeeId);

    return res.status(204).send();
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        committee_id: req.params['id'],
      },
      'Failed to delete committee'
    );
    return next(error);
  }
});

// Committee Members routes
// GET /api/committees/:id/members
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

// GET /api/committees/:id/members/:memberId
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

// POST /api/committees/:id/members
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

// PUT /api/committees/:id/members/:memberId
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

// DELETE /api/committees/:id/members/:memberId
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

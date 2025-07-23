// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response, Router } from 'express';

import { SupabaseService } from '../services/supabase.service';

const router = Router();

const supabaseService = new SupabaseService();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committees = await supabaseService.getCommittees(req.query as Record<string, any>);

    return res.json(committees);
  } catch (error) {
    console.error('Failed to fetch committees:', error);
    return next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committeeId = req.params['id'];

    if (!committeeId) {
      return res.status(400).json({
        error: 'Committee ID is required',
        code: 'MISSING_COMMITTEE_ID',
      });
    }

    const committee = await supabaseService.getCommitteeById(committeeId);

    if (!committee) {
      return res.status(404).json({
        error: 'Committee not found',
        code: 'COMMITTEE_NOT_FOUND',
      });
    }

    return res.json(committee);
  } catch (error) {
    console.error(`Failed to fetch committee ${req.params['id']}:`, error);
    return next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const committeeData = req.body;

    if (!committeeData?.name) {
      return res.status(400).json({
        error: 'Committee name is required',
        code: 'MISSING_COMMITTEE_NAME',
      });
    }

    if (!committeeData?.category) {
      return res.status(400).json({
        error: 'Committee category is required',
        code: 'MISSING_COMMITTEE_CATEGORY',
      });
    }

    const newCommittee = await supabaseService.createCommittee(committeeData);

    return res.status(201).json(newCommittee);
  } catch (error) {
    console.error('Failed to create committee:', error);
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
    console.error(`Failed to update committee ${req.params['id']}:`, error);
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
    console.error(`Failed to delete committee ${req.params['id']}:`, error);
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
    console.error(`Failed to fetch members for committee ${req.params['id']}:`, error);
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
    console.error(`Failed to fetch member ${req.params['memberId']} for committee ${req.params['id']}:`, error);
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
    console.error(`Failed to add member to committee ${req.params['id']}:`, error);
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
    console.error(`Failed to update member ${req.params['memberId']} for committee ${req.params['id']}:`, error);
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
    console.error(`Failed to remove member ${req.params['memberId']} from committee ${req.params['id']}:`, error);
    return next(error);
  }
});

export default router;

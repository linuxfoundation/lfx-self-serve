// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { CommitteeController } from '../controllers/committee.controller';

const router = Router();

const committeeController = new CommitteeController();

// Committee CRUD routes - using new controller pattern
router.get('/', (req, res, next) => committeeController.getCommittees(req, res, next));
router.get('/:id', (req, res, next) => committeeController.getCommitteeById(req, res, next));
router.post('/', (req, res, next) => committeeController.createCommittee(req, res, next));
router.put('/:id', (req, res, next) => committeeController.updateCommittee(req, res, next));
router.delete('/:id', (req, res, next) => committeeController.deleteCommittee(req, res, next));

// Committee member routes - now using committee controller
router.get('/:id/members', (req, res, next) => committeeController.getCommitteeMembers(req, res, next));
router.get('/:id/members/:memberId', (req, res, next) => committeeController.getCommitteeMemberById(req, res, next));
router.post('/:id/members', (req, res, next) => committeeController.createCommitteeMember(req, res, next));
router.put('/:id/members/:memberId', (req, res, next) => committeeController.updateCommitteeMember(req, res, next));
router.delete('/:id/members/:memberId', (req, res, next) => committeeController.deleteCommitteeMember(req, res, next));

export default router;

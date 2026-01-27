// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { VoteController } from '../controllers/vote.controller';

const router = Router();

const voteController = new VoteController();

// GET /votes - get all votes
router.get('/', (req, res, next) => voteController.getVotes(req, res, next));

// GET /votes/:uid - get a single vote
router.get('/:uid', (req, res, next) => voteController.getVoteById(req, res, next));

// POST /votes - create a new vote
router.post('/', (req, res, next) => voteController.createVote(req, res, next));

// PUT /votes/:uid - update a vote
router.put('/:uid', (req, res, next) => voteController.updateVote(req, res, next));

// DELETE /votes/:uid - delete a vote
router.delete('/:uid', (req, res, next) => voteController.deleteVote(req, res, next));

export default router;

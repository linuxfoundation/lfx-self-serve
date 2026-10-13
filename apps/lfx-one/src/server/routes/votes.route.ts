// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { VoteController } from '../controllers/vote.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';
import { voteWriteRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

const voteController = new VoteController();

// Every write is blocked while impersonating: upstream records ballots and vote changes as the
// target, with no actor identity in the payload. The guard runs before voteWriteRateLimiter so a
// refused write doesn't spend the authenticated caller's vote-write budget. Reads, including /:uid/my-response, stay open.

// GET /votes - get all votes
router.get('/', (req, res, next) => voteController.getVotes(req, res, next));

// GET /votes/count - get votes count
router.get('/count', (req, res, next) => voteController.getVotesCount(req, res, next));

// GET /votes/my-votes - get votes the current user has been invited to
router.get('/my-votes', (req, res, next) => voteController.getMyVotes(req, res, next));

// POST /votes/responses - submit a vote response (ballot)
// Note: literal-segment routes must precede '/:uid' handlers so Express
// doesn't accidentally match 'responses' as a uid for any future POST /:uid/* route.
router.post('/responses', blockDuringImpersonation, (req, res, next) => voteController.createVoteResponse(req, res, next));

// GET /votes/:uid/my-response - current user's pre-allocated vote_response (Me lens cast drawer)
router.get('/:uid/my-response', (req, res, next) => voteController.getMyVoteResponse(req, res, next));

// GET /votes/:uid/results - get vote results
router.get('/:uid/results', (req, res, next) => voteController.getVoteResults(req, res, next));

// GET /votes/:uid - get a single vote
router.get('/:uid', (req, res, next) => voteController.getVoteById(req, res, next));

// POST /votes - create a new vote
router.post('/', blockDuringImpersonation, voteWriteRateLimiter, (req, res, next) => voteController.createVote(req, res, next));

// PUT /votes/:uid - update a vote
router.put('/:uid', blockDuringImpersonation, (req, res, next) => voteController.updateVote(req, res, next));

// DELETE /votes/:uid - delete a vote
router.delete('/:uid', blockDuringImpersonation, (req, res, next) => voteController.deleteVote(req, res, next));

// PUT /votes/:uid/enable - enable a vote
router.put('/:uid/enable', blockDuringImpersonation, voteWriteRateLimiter, (req, res, next) => voteController.enableVote(req, res, next));

export default router;

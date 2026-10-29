// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { VoteController } from '../controllers/vote.controller';
import { voteWriteRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

const voteController = new VoteController();

// GET /votes - get all votes
router.get('/', (req, res, next) => voteController.getVotes(req, res, next));

// GET /votes/count - get votes count
router.get('/count', (req, res, next) => voteController.getVotesCount(req, res, next));

// GET /votes/summary - scoped management totals (must precede /:uid)
router.get('/summary', (req, res, next) => voteController.getVotesSummary(req, res, next));

// GET /votes/status-counts - per-status tab totals (must precede /:uid)
router.get('/status-counts', (req, res, next) => voteController.getVoteStatusCounts(req, res, next));

// GET /votes/my-votes - get votes the current user has been invited to
router.get('/my-votes', (req, res, next) => voteController.getMyVotes(req, res, next));

// POST /votes/responses - submit a vote response (ballot)
// Note: literal-segment routes must precede '/:uid' handlers so Express
// doesn't accidentally match 'responses' as a uid for any future POST /:uid/* route.
router.post('/responses', (req, res, next) => voteController.createVoteResponse(req, res, next));

// GET /votes/:uid/my-response - current user's pre-allocated vote_response (Me lens cast drawer)
router.get('/:uid/my-response', (req, res, next) => voteController.getMyVoteResponse(req, res, next));

// GET /votes/:uid/results - get vote results
router.get('/:uid/results', (req, res, next) => voteController.getVoteResults(req, res, next));

// GET /votes/:uid/reminder-recipients - eligible voters who have not voted yet (vote#writer only)
router.get('/:uid/reminder-recipients', (req, res, next) => voteController.getVoteReminderRecipients(req, res, next));

// GET /votes/:uid/voters - invited voters with their current ballot (vote#writer only, named votes)
router.get('/:uid/voters', (req, res, next) => voteController.getVoteVoters(req, res, next));

// GET /votes/:uid - get a single vote
router.get('/:uid', (req, res, next) => voteController.getVoteById(req, res, next));

// POST /votes - create a new vote
router.post('/', voteWriteRateLimiter, (req, res, next) => voteController.createVote(req, res, next));

// PUT /votes/:uid - update a vote
router.put('/:uid', (req, res, next) => voteController.updateVote(req, res, next));

// DELETE /votes/:uid - delete a vote
router.delete('/:uid', (req, res, next) => voteController.deleteVote(req, res, next));

// PUT /votes/:uid/enable - enable a vote
router.put('/:uid/enable', voteWriteRateLimiter, (req, res, next) => voteController.enableVote(req, res, next));

// POST /votes/:uid/reminders - resend the vote email to selected recipients
router.post('/:uid/reminders', voteWriteRateLimiter, (req, res, next) => voteController.sendVoteReminders(req, res, next));

// POST /votes/:uid/send-ballots - email a personalized ballot link to every non-responder (vote#writer only)
router.post('/:uid/send-ballots', voteWriteRateLimiter, (req, res, next) => voteController.sendVoteBallots(req, res, next));

// POST /votes/:uid/extend - extend a vote's deadline
router.post('/:uid/extend', voteWriteRateLimiter, (req, res, next) => voteController.extendVote(req, res, next));

// POST /votes/:uid/summary - send the on-demand close summary to every invited voter (#3662)
router.post('/:uid/summary', voteWriteRateLimiter, (req, res, next) => voteController.sendVoteSummary(req, res, next));

export default router;

// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE, FOUNDATION_MESSAGE_MAX_FILE_BYTES, MEMBER_360_MAX_BYTES } from '@lfx-one/shared/constants';
import express, { NextFunction, raw, Request, RequestHandler, Response, Router } from 'express';

import { AeoGeoController } from '../controllers/aeo-geo.controller';
import type { LinkedinPostController } from '../controllers/linkedin-post.controller';
import { Member360Controller } from '../controllers/member-360.controller';
import { Member360WorkbookController } from '../controllers/member-360-workbook.controller';
import { MktgAgentsController } from '../controllers/mktg-agents.controller';
import { MktgDocumentsController } from '../controllers/mktg-documents.controller';
import type { MktgRebuildController } from '../controllers/mktg-rebuild.controller';
import { MktgSlidesExportController } from '../controllers/mktg-slides-export.controller';
import { MicroserviceError } from '../errors';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

/**
 * Converts the raw body parser's size-limit error (`entity.too.large`) into a 413 before it reaches
 * the global error handler, which would otherwise flatten it into a 500. Mirrors
 * `mentorship-mentee.route.ts`'s `handleTaskFileParseError`.
 */
function handleDocumentFileParseError(err: unknown, req: Request, _res: Response, next: NextFunction): void {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    next(
      new MicroserviceError('File exceeds 20 MB', 413, 'PAYLOAD_TOO_LARGE', {
        operation: 'foundation_message_read_file',
        service: 'mktg_agents_controller',
        path: req.path,
      })
    );
    return;
  }
  next(err);
}

// Keep dedicated form dependencies out of unrelated Marketing OS route startup.
let linkedin: LinkedinPostController | undefined;
function linkedinRoute(method: keyof LinkedinPostController): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    void import('../controllers/linkedin-post.controller')
      .then(({ LinkedinPostController }) => {
        linkedin ??= new LinkedinPostController();
        return linkedin[method](req, res, next);
      })
      .catch(next);
  };
}

const router = Router();
router.get('/linkedin-post/profile', linkedinRoute('getProfile'));
router.put('/linkedin-post/profile', blockDuringImpersonation, linkedinRoute('saveProfile'));
router.delete('/linkedin-post/profile', blockDuringImpersonation, linkedinRoute('deleteProfile'));
router.post(
  '/linkedin-post/generate',
  (req, res, next) => {
    if (req.body?.setup !== undefined) {
      blockDuringImpersonation(req, res, next);
      return;
    }
    next();
  },
  linkedinRoute('generate')
);
router.post('/linkedin-post/result', linkedinRoute('result'));
router.post('/linkedin-post/answers', linkedinRoute('answer'));
router.patch('/linkedin-post/documents/:documentId/share-link', blockDuringImpersonation, linkedinRoute('saveShareLink'));
const mktgAgentsController = new MktgAgentsController();
const mktgDocumentsController = new MktgDocumentsController();
const mktgSlidesExportController = new MktgSlidesExportController();
const member360Controller = new Member360Controller();
const member360Workbook = new Member360WorkbookController();
const aeoGeoController = new AeoGeoController();

router.get('/member-360/documents/:documentId/workbook', (req, res, next) => member360Workbook.download(req, res, next));
router.post(
  '/member-360/tracker',
  raw({ type: 'application/octet-stream', limit: MEMBER_360_MAX_BYTES }),
  (err: unknown, req: Request, _res: Response, next: NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
      next(new MicroserviceError('The tracker exceeds 5 MB.', 413, 'PAYLOAD_TOO_LARGE', { operation: 'member_360_tracker', path: req.path }));
      return;
    }
    next(err);
  },
  (req: Request, res: Response, next: NextFunction) => member360Workbook.parseTracker(req, res, next)
);

router.post('/member-360/generate', (req, res, next) => member360Controller.generate(req, res, next));
router.post('/member-360/result', (req, res, next) => member360Controller.result(req, res, next));
router.post('/aeo-geo/generate', (req, res, next) => aeoGeoController.generate(req, res, next));
router.post('/aeo-geo/result', (req, res, next) => aeoGeoController.result(req, res, next));
router.post('/aeo-geo/answers', (req, res, next) => aeoGeoController.answers(req, res, next));

let rebuild: MktgRebuildController | undefined;
function rebuildRoute(method: keyof MktgRebuildController): RequestHandler {
  return (req, res, next): void => {
    void import('../controllers/mktg-rebuild.controller')
      .then(({ MktgRebuildController }) => {
        rebuild ??= new MktgRebuildController();
        return rebuild[method](req, res, next);
      })
      .catch(next);
  };
}

// Every chain endpoint can persist a Draft/turn and is a writer operation.
router.post('/rebuild/start', blockDuringImpersonation, rebuildRoute('start'));
router.post('/rebuild/advance', blockDuringImpersonation, rebuildRoute('advance'));
router.post('/rebuild/result', blockDuringImpersonation, rebuildRoute('result'));

// GET /api/mktg-agents/intakes/:agentKey/last - private scalar history; the service resolves writer access.
router.get('/intakes/:agentKey/last', (req, res, next) => mktgAgentsController.getLastIntake(req, res, next));

// POST /api/mktg-agents/chat - create a Guild session or post a follow-up
router.post('/chat', (req, res, next) => mktgAgentsController.chat(req, res, next));

// POST /api/mktg-agents/history - fetch mapped session history (owner-token in body)
router.post('/history', (req, res, next) => mktgAgentsController.history(req, res, next));

// POST /api/mktg-agents/brand-kit/generate - start a Brand Kit draft from the form and the uploaded logo files
router.post('/brand-kit/generate', (req, res, next) => mktgAgentsController.generateBrandKit(req, res, next));

// POST /api/mktg-agents/brand-kit/answers - answer the session's questions turn (owner-token in body), on the same session
router.post('/brand-kit/answers', (req, res, next) => mktgAgentsController.brandKitAnswers(req, res, next));

// POST /api/mktg-agents/brand-kit/result - poll a generation session for the validated kit
router.post('/brand-kit/result', (req, res, next) => mktgAgentsController.brandKitResult(req, res, next));

// GET /api/mktg-agents/brand-kit/stored - approved current plain/sidecar bytes or 404; true pre-revision plain fallback only (writer-entitled).
router.get('/brand-kit/stored', (req, res, next) => mktgAgentsController.storedBrandKit(req, res, next));

// POST /api/mktg-agents/foundation-message/generate - start a Messaging Framework draft
router.post('/foundation-message/generate', (req, res, next) => mktgAgentsController.generateFoundationMessage(req, res, next));

// POST /api/mktg-agents/foundation-message/result - poll a generation session for the validated framework (or the agent's questions)
router.post('/foundation-message/result', (req, res, next) => mktgAgentsController.foundationMessageResult(req, res, next));

// POST /api/mktg-agents/foundation-message/documents/file - read one uploaded document to text (raw body, at most 20 MB)
router.post(
  '/foundation-message/documents/file',
  express.raw({ type: FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE, limit: FOUNDATION_MESSAGE_MAX_FILE_BYTES }),
  handleDocumentFileParseError,
  (req: Request, res: Response, next: NextFunction) => mktgAgentsController.readFoundationMessageFile(req, res, next)
);

// POST /api/mktg-agents/foundation-message/answers - answer the session's questions turn (owner-token in body), on the same session
router.post('/foundation-message/answers', (req, res, next) => mktgAgentsController.foundationMessageAnswers(req, res, next));

// POST /api/mktg-agents/boilerplates/generate - start a Boilerplates draft from the form and the attached messaging framework
router.post('/boilerplates/generate', (req, res, next) => mktgAgentsController.generateBoilerplates(req, res, next));

// POST /api/mktg-agents/boilerplates/answers - answer the session's questions turn (owner-token in body), on the same session
router.post('/boilerplates/answers', (req, res, next) => mktgAgentsController.boilerplatesAnswers(req, res, next));

// POST /api/mktg-agents/boilerplates/result - poll a generation session for the validated boilerplates (or the agent's questions)
router.post('/boilerplates/result', (req, res, next) => mktgAgentsController.boilerplatesResult(req, res, next));

// POST /api/mktg-agents/icp/generate - start a one-shot form-mode ICP & Target Markets generation
router.post('/icp/generate', (req, res, next) => mktgAgentsController.generateIcp(req, res, next));

// POST /api/mktg-agents/icp/result - poll a generation session for the validated document
router.post('/icp/result', (req, res, next) => mktgAgentsController.icpResult(req, res, next));

// POST /api/mktg-agents/faq/generate - start an FAQ draft from the form, its documents and the attached messaging framework
router.post('/faq/generate', (req, res, next) => mktgAgentsController.generateFaq(req, res, next));

// POST /api/mktg-agents/faq/answers - answer the session's questions turn (owner-token in body), on the same session
router.post('/faq/answers', (req, res, next) => mktgAgentsController.faqAnswers(req, res, next));

// POST /api/mktg-agents/faq/result - poll a generation session for the validated FAQ (or the agent's questions, or the reply that ended the run)
router.post('/faq/result', (req, res, next) => mktgAgentsController.faqResult(req, res, next));

// GET /api/mktg-agents/foundation-message/stored - approved current plain/sidecar bytes or 404; true pre-revision plain fallback only (writer-entitled).
router.get('/foundation-message/stored', (req, res, next) => mktgAgentsController.storedFoundationMessage(req, res, next));

// GET /api/mktg-agents/documents?project=<uid> - every stored Marketing OS document of the project, grouped by type (writer-entitled callers only)
router.get('/documents', (req, res, next) => mktgDocumentsController.listDocuments(req, res, next));

// GET /api/mktg-agents/documents/:agentKey/:documentId?project=<uid> - one document and its revisions, newest first
router.get('/documents/:agentKey/:documentId', (req, res, next) => mktgDocumentsController.getDocument(req, res, next));

// GET /api/mktg-agents/documents/:agentKey/:documentId/revisions/:revisionId?project=<uid> - one revision with its Markdown
router.get('/documents/:agentKey/:documentId/revisions/:revisionId', (req, res, next) => mktgDocumentsController.getRevision(req, res, next));

// POST /api/mktg-agents/documents/:agentKey/:documentId/revisions/:revisionId/approve?project=<uid>
router.post('/documents/:agentKey/:documentId/revisions/:revisionId/approve', blockDuringImpersonation, (req, res, next) =>
  mktgDocumentsController.approveRevision(req, res, next)
);

// GET revision-scoped field comments; requires project writer access.
router.get('/documents/:agentKey/:documentId/comments', (req, res, next) => mktgDocumentsController.listComments(req, res, next));
// POST a field comment; requires project writer access and a stored revision.
router.post('/documents/:agentKey/:documentId/comments', blockDuringImpersonation, (req, res, next) => mktgDocumentsController.addComment(req, res, next));
// POST /api/mktg-agents/documents/:agentKey/:documentId/revise - ID-only comments redraft; project writer access; creator-bound ACK.
router.post('/documents/:agentKey/:documentId/revise', blockDuringImpersonation, (req, res, next) => mktgDocumentsController.revise(req, res, next));
// GET creator-owned terminal recovery proof; no private ledger/session fields or mutation.
router.get('/documents/:agentKey/:documentId/revise/:requestId/state', (req, res, next) => mktgDocumentsController.redraftState(req, res, next));
// POST release an uncertain/expired reservation; requires project writer access AND the original send creator.
router.post('/documents/:agentKey/:documentId/revise/:requestId/release', blockDuringImpersonation, (req, res, next) =>
  mktgDocumentsController.releaseRedraft(req, res, next)
);

// POST /api/mktg-agents/documents/:agentKey/:documentId/restore - move current without adding a revision
router.post('/documents/:agentKey/:documentId/restore', (req, res, next) => mktgDocumentsController.restoreRevision(req, res, next));

// POST /api/mktg-agents/documents/:agentKey/:documentId/runs/:runId/retry - recheck a recorded session, not a generation
router.post('/documents/:agentKey/:documentId/runs/:runId/retry', (req, res, next) => mktgDocumentsController.retryRun(req, res, next));

// Family exports: the document writer boundary, with every family operation blocked while impersonating.
router.post('/slides-export/family/start', blockDuringImpersonation, (req, res, next) => mktgSlidesExportController.family(req, res, next, 'start'));
router.post('/slides-export/family/result', blockDuringImpersonation, (req, res, next) => mktgSlidesExportController.family(req, res, next, 'result'));
router.get('/slides-export/family/last', blockDuringImpersonation, (req, res, next) => mktgSlidesExportController.family(req, res, next, 'last'));

// POST /api/mktg-agents/slides-export/start - export a stored Messaging Framework or Brand Kit revision to Google Slides (a new deck, or the last export's deck refreshed in place)
router.post('/slides-export/start', (req, res, next) => mktgSlidesExportController.start(req, res, next));

// POST /api/mktg-agents/slides-export/result - poll an export (owner-token in body); a ready deck is kept with the revision it was made from
router.post('/slides-export/result', (req, res, next) => mktgSlidesExportController.result(req, res, next));

// GET /api/mktg-agents/slides-export/last - last export plus approved-current identity for freshness (null when none approved), not byte selection.
router.get('/slides-export/last', (req, res, next) => mktgSlidesExportController.last(req, res, next));

export default router;

import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

/** Standard CRUD + review + cancel router for request-style resources. */
export function requestRouter({ ctrl, createSchema, updateSchema, reviewSchema, before }) {
  const r = Router();
  r.use(protect);
  if (before) before(r);
  r.get('/stats', ctrl.stats);
  r.get('/', ctrl.list);
  r.post('/', validate(createSchema), ctrl.create);
  r.get('/:id', ctrl.getOne);
  r.put('/:id', validate(updateSchema), ctrl.update);
  r.patch('/:id', validate(updateSchema), ctrl.update);
  r.patch('/:id/status', validate(reviewSchema), ctrl.review);
  r.patch('/:id/cancel', ctrl.cancel);
  r.delete('/:id', ctrl.remove);
  return r;
}

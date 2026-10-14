import { leaveBalance, leaveCtrl } from '../controllers/leaveController.js';
import { compOffCtrl } from '../controllers/compOffController.js';
import { regularizationCtrl } from '../controllers/regularizationController.js';
import { visitorCtrl } from '../controllers/visitorController.js';
import { travelExpenseCtrl } from '../controllers/travelExpenseController.js';
import { reviewSchema } from '../validators/common.js';
import * as v from '../validators/requests.js';
import { requestRouter } from './requestRouter.js';

export const leaveRoutes = requestRouter({
  ctrl: leaveCtrl, createSchema: v.leaveCreate, updateSchema: v.leaveUpdate, reviewSchema: reviewSchema(),
  before: (r) => r.get('/balance', leaveBalance),
});
export const compOffRoutes = requestRouter({
  ctrl: compOffCtrl, createSchema: v.compOffCreate, updateSchema: v.compOffUpdate, reviewSchema: reviewSchema(),
});
export const regularizationRoutes = requestRouter({
  ctrl: regularizationCtrl, createSchema: v.regularizationCreate, updateSchema: v.regularizationUpdate, reviewSchema: reviewSchema(),
});
export const visitorRoutes = requestRouter({
  ctrl: visitorCtrl, createSchema: v.visitorCreate, updateSchema: v.visitorUpdate, reviewSchema: reviewSchema(),
});
export const travelExpenseRoutes = requestRouter({
  ctrl: travelExpenseCtrl, createSchema: v.travelCreate, updateSchema: v.travelUpdate,
  reviewSchema: reviewSchema(['approved', 'rejected', 'paid']),
});

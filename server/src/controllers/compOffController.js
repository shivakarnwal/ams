import { CompOff } from '../models/CompOff.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { todayString } from '../utils/helpers.js';
import { createRequestController } from './requestController.js';

const creditOf = (doc) => (doc.appliedFor === 'full' ? 1 : 0.5);

async function assertNotDuplicate(employee, workDate, excludeId) {
  const q = { employee, workDate, status: { $in: ['pending', 'approved'] } };
  if (excludeId) q._id = { $ne: excludeId };
  if (await CompOff.exists(q)) throw ApiError.conflict('A comp-off request already exists for this date');
}

async function reverseCredit(doc) {
  if (!doc.credited) return;
  const credit = creditOf(doc);
  const res = await User.updateOne(
    { _id: doc.employee, 'leaveBalance.compOff': { $gte: credit } },
    { $inc: { 'leaveBalance.compOff': -credit } },
  );
  if (res.modifiedCount !== 1) throw ApiError.conflict('This comp-off has already been used and cannot be reversed');
  await CompOff.updateOne({ _id: doc._id }, { credited: false });
}

export const compOffCtrl = createRequestController({
  Model: CompOff,
  label: 'Comp-off request',
  dateField: 'workDate',
  cancellableFrom: ['pending', 'approved'],
  hooks: {
    async prepareCreate(data, req) {
      if (data.workDate > new Date(todayString())) throw ApiError.badRequest('Comp-off date cannot be in the future');
      await assertNotDuplicate(req.user._id, data.workDate);
      return data;
    },
    async prepareUpdate(doc, data) {
      if (data.workDate) {
        if (data.workDate > new Date(todayString())) throw ApiError.badRequest('Comp-off date cannot be in the future');
        await assertNotDuplicate(doc.employee, data.workDate, doc._id);
      }
      return data;
    },
    async onReview(doc, _prev, next) {
      if (next !== 'approved') return;
      await User.updateOne({ _id: doc.employee }, { $inc: { 'leaveBalance.compOff': creditOf(doc) } });
      await CompOff.updateOne({ _id: doc._id }, { credited: true });
    },
    async onCancel(doc, prev) {
      if (prev === 'approved') await reverseCredit(doc);
    },
    async beforeDelete(doc) {
      if (doc.status === 'approved') await reverseCredit(doc);
    },
  },
});

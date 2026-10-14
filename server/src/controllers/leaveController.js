import { Leave, BALANCE_KEY } from '../models/Leave.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, isValidId, ok } from '../utils/helpers.js';
import { canAccessEmployee } from '../utils/access.js';
import { daysBetweenInclusive } from '../utils/time.js';
import { createRequestController } from './requestController.js';

const computeDays = (duration, start, end) => (duration === 'full' ? daysBetweenInclusive(start, end) : 0.5);

async function assertNoOverlap(employee, start, end, excludeId) {
  const q = { employee, status: { $in: ['pending', 'approved'] }, startDate: { $lte: end }, endDate: { $gte: start } };
  if (excludeId) q._id = { $ne: excludeId };
  if (await Leave.exists(q)) throw ApiError.conflict('You already have a leave request overlapping these dates');
}

async function assertBalance(userId, leaveType, days) {
  const user = await User.findById(userId).select('leaveBalance');
  const available = user.leaveBalance[BALANCE_KEY[leaveType]] ?? 0;
  if (available < days) {
    throw ApiError.badRequest(`Insufficient ${leaveType.replace('_', ' ')} balance (available: ${available}, requested: ${days})`);
  }
}

const refund = (doc) =>
  User.updateOne({ _id: doc.employee }, { $inc: { [`leaveBalance.${BALANCE_KEY[doc.leaveType]}`]: doc.numDays } });

export const leaveCtrl = createRequestController({
  Model: Leave,
  label: 'Leave request',
  filterFields: ['status', 'leaveType'],
  dateField: 'startDate',
  cancellableFrom: ['pending', 'approved'],
  hooks: {
    async prepareCreate(data, req) {
      data.numDays = computeDays(data.duration, data.startDate, data.endDate);
      await assertNoOverlap(req.user._id, data.startDate, data.endDate);
      await assertBalance(req.user._id, data.leaveType, data.numDays);
      return data;
    },
    async prepareUpdate(doc, data) {
      const merged = { ...doc.toObject(), ...data };
      data.numDays = computeDays(merged.duration, merged.startDate, merged.endDate);
      if (merged.endDate < merged.startDate) throw ApiError.badRequest('End date cannot be before start date');
      await assertNoOverlap(doc.employee, merged.startDate, merged.endDate, doc._id);
      await assertBalance(doc.employee, merged.leaveType, data.numDays);
      return data;
    },
    async onReview(doc, _prev, next) {
      if (next !== 'approved') return;
      const key = `leaveBalance.${BALANCE_KEY[doc.leaveType]}`;
      const res = await User.updateOne(
        { _id: doc.employee, [key]: { $gte: doc.numDays } },
        { $inc: { [key]: -doc.numDays } },
      );
      if (res.modifiedCount !== 1) throw ApiError.badRequest('Employee does not have enough leave balance to approve this request');
      await Leave.updateOne({ _id: doc._id }, { balanceDeducted: true });
    },
    async onCancel(doc, prev) {
      if (prev === 'approved' && doc.balanceDeducted) {
        await refund(doc);
        await Leave.updateOne({ _id: doc._id }, { balanceDeducted: false });
      }
    },
    async beforeDelete(doc) {
      if (doc.status === 'approved' && doc.balanceDeducted) await refund(doc);
    },
  },
});

/** GET /leaves/balance — balances + days used this calendar year */
export const leaveBalance = asyncHandler(async (req, res) => {
  const targetId = req.query.employeeId && typeof req.query.employeeId === 'string' ? req.query.employeeId : String(req.user._id);
  if (!isValidId(targetId)) throw ApiError.badRequest('Invalid employeeId');
  if (!(await canAccessEmployee(req.user, targetId))) throw ApiError.forbidden();

  const user = await User.findById(targetId).select('leaveBalance');
  if (!user) throw ApiError.notFound('Employee not found');

  const year = new Date().getUTCFullYear();
  const approved = await Leave.find({
    employee: targetId, status: 'approved',
    startDate: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) },
  }).select('leaveType numDays').lean();

  const used = { sick: 0, earned: 0, casual: 0, compOff: 0, maternity: 0 };
  for (const l of approved) used[BALANCE_KEY[l.leaveType]] += l.numDays;
  ok(res, { balance: user.leaveBalance, used });
});

import { Attendance } from '../models/Attendance.js';
import { Regularization } from '../models/Regularization.js';
import { ApiError } from '../utils/ApiError.js';
import { todayString } from '../utils/helpers.js';
import { minutesBetween, zonedToUtc } from '../utils/time.js';
import { createRequestController } from './requestController.js';

async function assertValid(data, employee, excludeId) {
  if (data.date > todayString()) throw ApiError.badRequest('Regularization date cannot be in the future');
  const q = { employee, type: data.type, date: data.date, status: 'pending' };
  if (excludeId) q._id = { $ne: excludeId };
  if (await Regularization.exists(q)) throw ApiError.conflict('A pending request of this type already exists for that date');
}

async function applyToAttendance(reg) {
  const { employee, date, type, time } = reg;
  const att = (await Attendance.findOne({ employee, date })) || new Attendance({ employee, date, status: 'present' });
  if (type === 'in-punch') { att.inTime = zonedToUtc(date, time); att.status = 'present'; }
  else if (type === 'out-punch') { att.outTime = zonedToUtc(date, time); att.status = 'present'; }
  else if (type === 'on-duty') att.status = 'on_duty';
  else if (type === 'wfh') att.status = 'wfh';

  if (att.inTime && att.outTime) {
    if (att.outTime <= att.inTime) throw ApiError.badRequest('Out time must be after in time for that day');
    att.workMinutes = minutesBetween(att.inTime, att.outTime);
  }
  att.source = 'regularization';
  await att.save();
}

export const regularizationCtrl = createRequestController({
  Model: Regularization,
  label: 'Regularization request',
  filterFields: ['status', 'type'],
  dateField: 'date',
  dateIsString: true,
  statsGroupField: 'type',
  hooks: {
    async prepareCreate(data, req) { await assertValid(data, req.user._id); return data; },
    async prepareUpdate(doc, data) {
      const merged = { ...doc.toObject(), ...data };
      if (['in-punch', 'out-punch'].includes(merged.type) && !merged.time) throw ApiError.badRequest('Time is required for punch regularization');
      await assertValid(merged, doc.employee, doc._id);
      return data;
    },
    async onReview(doc, _prev, next) { if (next === 'approved') await applyToAttendance(doc); },
  },
});

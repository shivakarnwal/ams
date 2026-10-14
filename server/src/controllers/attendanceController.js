import { env } from '../config/env.js';
import { Attendance } from '../models/Attendance.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, isValidId, ok, todayString } from '../utils/helpers.js';
import { canAccessEmployee, ownerFilter } from '../utils/access.js';
import { DAY_MS, minutesBetween, zonedToUtc } from '../utils/time.js';

const monthOf = (s) => (typeof s === 'string' && /^\d{4}-\d{2}$/.test(s) ? s : todayString().slice(0, 7));
const monthBounds = (month) => ({ from: `${month}-01`, to: `${month}-31` });

function applyTimes(att, inTime, outTime) {
  if (inTime) att.inTime = zonedToUtc(att.date, inTime);
  if (outTime) att.outTime = zonedToUtc(att.date, outTime);
  if (att.inTime && att.outTime) {
    if (att.outTime <= att.inTime) throw ApiError.badRequest('Out time must be after in time');
    att.workMinutes = minutesBetween(att.inTime, att.outTime);
  }
}

export const list = asyncHandler(async (req, res) => {
  const month = monthOf(req.query.month);
  const filter = { ...(await ownerFilter(req)), date: { $gte: monthBounds(month).from, $lte: monthBounds(month).to } };
  const items = await Attendance.find(filter).sort({ date: 1 }).populate('employee', 'name employeeCode');
  const totalMinutes = items.reduce((sum, a) => sum + (a.workMinutes || 0), 0);
  const counts = {};
  for (const a of items) counts[a.status] = (counts[a.status] || 0) + 1;
  ok(res, items, { meta: { month, totalMinutes, counts } });
});

export const today = asyncHandler(async (req, res) => {
  ok(res, await Attendance.findOne({ employee: req.user._id, date: todayString() }));
});

export const punchIn = asyncHandler(async (req, res) => {
  const date = todayString();
  let att = await Attendance.findOne({ employee: req.user._id, date });
  if (att?.inTime) throw ApiError.conflict('You have already punched in today');
  if (!att) att = new Attendance({ employee: req.user._id, date, status: 'present', source: 'punch' });
  att.inTime = new Date();
  await att.save();
  ok(res, att, { message: 'Punched in successfully' }, 201);
});

export const punchOut = asyncHandler(async (req, res) => {
  const att = await Attendance.findOne({ employee: req.user._id, date: todayString() });
  if (!att?.inTime) throw ApiError.badRequest('You have not punched in today');
  if (att.outTime) throw ApiError.conflict('You have already punched out today');
  att.outTime = new Date();
  att.workMinutes = minutesBetween(att.inTime, att.outTime);
  if (att.status === 'present' && att.workMinutes < 240) att.status = 'half_day';
  await att.save();
  ok(res, att, { message: 'Punched out successfully' });
});

/** Monday (YYYY-MM-DD) of the week containing `dateStr` */
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

export const summary = asyncHandler(async (req, res) => {
  const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : String(req.user._id);
  if (!isValidId(employeeId)) throw ApiError.badRequest('Invalid employeeId');
  if (!(await canAccessEmployee(req.user, employeeId))) throw ApiError.forbidden();

  const todayStr = todayString();
  const month = monthOf(req.query.month);
  const [y, m] = todayStr.split('-').map(Number);
  const sixAgo = new Date(Date.UTC(y, m - 6, 1)).toISOString().slice(0, 7);
  const records = await Attendance.find({ employee: employeeId, date: { $gte: `${sixAgo}-01`, $lte: `${todayStr.slice(0, 7)}-31` } })
    .select('date workMinutes status').lean();

  const wkStart = weekStart(todayStr);
  const weekMinutes = records.filter((r) => r.date >= wkStart && r.date <= todayStr).reduce((s, r) => s + r.workMinutes, 0);

  const monthly = [];
  for (let i = 5; i >= 0; i -= 1) {
    const key = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    const minutes = records.filter((r) => r.date.startsWith(key)).reduce((s, r) => s + r.workMinutes, 0);
    monthly.push({ month: key, hours: Math.round((minutes / 60) * 10) / 10 });
  }
  const counts = {};
  for (const r of records.filter((x) => x.date.startsWith(month))) counts[r.status] = (counts[r.status] || 0) + 1;

  ok(res, {
    week: { start: wkStart, completedMinutes: weekMinutes, targetMinutes: env.weeklyTargetHours * 60 },
    monthlyDutyHours: monthly,
    month, counts,
    today: await Attendance.findOne({ employee: employeeId, date: todayStr }),
  });
});

/* ---- HR / admin manual maintenance ---- */
export const createManual = asyncHandler(async (req, res) => {
  const { employee, date, inTime, outTime, status, note } = req.body;
  if (!(await User.exists({ _id: employee }))) throw ApiError.badRequest('Employee not found');
  if (await Attendance.exists({ employee, date })) throw ApiError.conflict('Attendance already exists for this employee and date');
  const att = new Attendance({ employee, date, status, note, source: 'manual' });
  applyTimes(att, inTime, outTime);
  await att.save();
  ok(res, att, { message: 'Attendance record created' }, 201);
});

export const updateManual = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const att = await Attendance.findById(req.params.id);
  if (!att) throw ApiError.notFound('Attendance record not found');
  const { inTime, outTime, ...rest } = req.body;
  att.set(rest);
  applyTimes(att, inTime, outTime);
  att.source = 'manual';
  await att.save();
  ok(res, att, { message: 'Attendance record updated' });
});

export const remove = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const att = await Attendance.findByIdAndDelete(req.params.id);
  if (!att) throw ApiError.notFound('Attendance record not found');
  ok(res, null, { message: 'Attendance record deleted' });
});

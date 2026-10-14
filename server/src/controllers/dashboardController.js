import { Announcement } from '../models/Announcement.js';
import { Attendance } from '../models/Attendance.js';
import { CompOff } from '../models/CompOff.js';
import { Holiday } from '../models/Holiday.js';
import { Leave } from '../models/Leave.js';
import { Regularization } from '../models/Regularization.js';
import { TravelExpense } from '../models/TravelExpense.js';
import { User } from '../models/User.js';
import { Visitor } from '../models/Visitor.js';
import { asyncHandler, ok, todayString } from '../utils/helpers.js';
import { isPrivileged, teamIds } from '../utils/access.js';

async function pendingApprovals(user) {
  let ownerFilter;
  if (isPrivileged(user)) ownerFilter = { $ne: user._id };
  else if (user.role === 'manager') ownerFilter = { $in: await teamIds(user) };
  const models = { leaves: Leave, compOffs: CompOff, regularizations: Regularization, visitors: Visitor, travelExpenses: TravelExpense };
  const out = {};
  await Promise.all(
    Object.entries(models).map(async ([key, Model]) => {
      out[key] = ownerFilter ? await Model.countDocuments({ status: 'pending', employee: ownerFilter }) : 0;
    }),
  );
  out.total = Object.values(out).reduce((a, b) => a + b, 0);
  return out;
}

export const dashboard = asyncHandler(async (req, res) => {
  const { user } = req;
  const today = todayString();
  const [mm, dd] = [today.slice(5, 7), today.slice(8, 10)];
  const year = Number(today.slice(0, 4));

  const [holidays, announcements, approvals, myPendingLeaves, todayAttendance, joiners] = await Promise.all([
    Holiday.find({ date: { $gte: new Date(today) } }).sort({ date: 1 }).limit(5),
    Announcement.find().sort({ createdAt: -1 }).limit(5).populate('createdBy', 'name'),
    pendingApprovals(user),
    Leave.countDocuments({ employee: user._id, status: 'pending' }),
    Attendance.findOne({ employee: user._id, date: today }),
    User.find({ status: 'active', dateOfJoining: { $ne: null } }).select('name employeeCode designation dateOfJoining avatar').lean(),
  ]);

  const anniversaries = joiners
    .filter((u) => {
      const iso = new Date(u.dateOfJoining).toISOString();
      return iso.slice(5, 7) === mm && iso.slice(8, 10) === dd && Number(iso.slice(0, 4)) < year;
    })
    .map((u) => ({ ...u, id: String(u._id), years: year - new Date(u.dateOfJoining).getUTCFullYear() }));

  ok(res, {
    user: { id: user._id, name: user.name, designation: user.designation, role: user.role, employeeCode: user.employeeCode },
    today,
    leaveBalance: user.leaveBalance,
    holidays, announcements, anniversaries,
    pendingApprovals: approvals,
    myPending: { leaves: myPendingLeaves },
    attendanceToday: todayAttendance,
  });
});

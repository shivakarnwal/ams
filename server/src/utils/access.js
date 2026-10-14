import { User } from '../models/User.js';
import { ApiError } from './ApiError.js';
import { isValidId } from './helpers.js';

export const isPrivileged = (user) => ['hr', 'admin'].includes(user.role);
export const isReviewer = (user) => ['manager', 'hr', 'admin'].includes(user.role);

/** _ids of the user's direct reports */
export async function teamIds(user) {
  return User.find({ manager: user._id }).distinct('_id');
}

/** Can `user` see / act on records owned by `employeeId`? */
export async function canAccessEmployee(user, employeeId) {
  const id = String(employeeId?._id || employeeId);
  if (id === String(user._id)) return true;
  if (isPrivileged(user)) return true;
  if (user.role === 'manager') return Boolean(await User.exists({ _id: id, manager: user._id }));
  return false;
}

/**
 * Builds the owner filter for list endpoints from `?scope=me|team|all` and optional `?employeeId=`.
 *  me   -> own records (default)
 *  team -> manager: direct reports, hr/admin: everyone
 *  all  -> hr/admin only
 */
export async function ownerFilter(req, field = 'employee') {
  const { user } = req;
  const scope = req.query.scope || 'me';
  const employeeId = req.query.employeeId;

  if (employeeId) {
    if (!isValidId(employeeId)) throw ApiError.badRequest('Invalid employeeId');
    if (!(await canAccessEmployee(user, employeeId))) throw ApiError.forbidden();
    return { [field]: employeeId };
  }
  if (scope === 'me') return { [field]: user._id };
  if (scope === 'team') {
    if (user.role === 'employee') throw ApiError.forbidden();
    if (isPrivileged(user)) return {};
    return { [field]: { $in: await teamIds(user) } };
  }
  if (scope === 'all') {
    if (!isPrivileged(user)) throw ApiError.forbidden();
    return {};
  }
  throw ApiError.badRequest('Invalid scope');
}

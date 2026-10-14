import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { signToken } from '../middleware/auth.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, ok } from '../utils/helpers.js';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function nextEmployeeCode() {
  const last = await User.find({ employeeCode: /^\d+$/ }).sort({ createdAt: -1 }).limit(1).select('employeeCode').lean();
  return String((last[0] ? Number(last[0].employeeCode) : 1100000) + 1);
}

export const login = asyncHandler(async (req, res) => {
  const { email, password, device_id: deviceId } = req.body;
  const user = await User.findOne({ email }).select('+password');
  const valid = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !valid) throw new ApiError(401, 'Invalid email or password');
  if (user.status !== 'active') throw ApiError.forbidden('Your account is inactive. Please contact HR.');

  user.lastLoginAt = new Date();
  if (deviceId) user.lastDeviceId = deviceId;
  await User.updateOne({ _id: user._id }, { lastLoginAt: user.lastLoginAt, ...(deviceId ? { lastDeviceId: deviceId } : {}) });

  res.json({ success: true, message: 'Login successful', token: signToken(user), user: user.toJSON() });
});

export const register = asyncHandler(async (req, res) => {
  if (!env.allowPublicSignup) throw ApiError.forbidden('Public sign up is disabled. Please ask HR to create your account.');
  const user = await User.create({ ...req.body, role: 'employee', employeeCode: await nextEmployeeCode() });
  res.status(201).json({ success: true, message: 'Account created successfully', token: signToken(user), user: user.toJSON() });
});

export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('manager', 'name employeeCode designation email');
  ok(res, user);
});

/**
 * Personal details (name, date of birth) are HR-managed and change through the profile module
 * (PUT /profiles/:id/general). Here users may only update contact number / address / avatar; an Admin may still
 * correct their own name. HR users cannot change their own personal details (same rule as the profile module).
 */
const HR_ONLY_PROFILE_FIELDS = ['name', 'dateOfBirth'];

export const updateProfile = asyncHandler(async (req, res) => {
  const locked = HR_ONLY_PROFILE_FIELDS.filter((k) => req.body[k] !== undefined && req.user.role !== 'admin');
  if (locked.length) throw ApiError.forbidden('Personal details can only be changed by HR or Admin. Please raise a ticket with HR.');
  req.user.set(req.body);
  await req.user.save();
  ok(res, await User.findById(req.user._id).populate('manager', 'name employeeCode designation email'), { message: 'Profile updated successfully' });
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(req.body.currentPassword))) throw new ApiError(422, 'Validation failed', { currentPassword: 'Current password is incorrect' });
  user.password = req.body.newPassword;
  user.tokenVersion += 1;
  await user.save();
  res.json({ success: true, message: 'Password changed successfully', token: signToken(user) });
});

/** Stateless JWT: bump tokenVersion so every issued token stops working. */
export const logout = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  ok(res, null, { message: 'Logged out successfully' });
});

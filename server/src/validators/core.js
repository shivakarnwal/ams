import { z } from 'zod';
import { ROLES } from '../models/User.js';
import { dateInput, objectId, optionalDate, phone, text } from './common.js';

const password = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

const email = z.string({ required_error: 'Email is required' }).trim().toLowerCase().email('Enter a valid email address');

export const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
  device_id: z.string().trim().max(200).optional(),
});

export const registerSchema = z.object({
  name: text('Name', 120, 2),
  email,
  password,
  contact: phone.optional().default(''),
});

export const profileSchema = z
  .object({
    name: text('Name', 120, 2),
    contact: phone,
    address: z.string().trim().max(300),
    // Self-service profile photos are stored as small, browser-resized JPEG data URLs.
    avatar: z.string().trim().max(200_000).refine((value) => value.length <= 500 || /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value), 'Use a valid profile photo'),
    dateOfBirth: optionalDate('Date of birth'),
  })
  .partial();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Current password is required'), newPassword: password })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'New password must be different' });

const managerField = z.preprocess((v) => (v === '' ? null : v), objectId.nullable());

const employeeBase = z.object({
  employeeCode: text('Employee code', 30),
  name: text('Name', 120, 2),
  email,
  password,
  role: z.enum(ROLES).default('employee'),
  designation: z.string().trim().max(100).default(''),
  department: z.string().trim().max(100).default(''),
  location: z.string().trim().max(100).default(''),
  branch: z.string().trim().max(100).default(''),
  contact: phone.default(''),
  address: z.string().trim().max(300).default(''),
  dateOfJoining: optionalDate('Date of joining'),
  dateOfBirth: optionalDate('Date of birth'),
  manager: managerField.optional(),
  status: z.enum(['active', 'inactive']).default('active'),
});
export const employeeCreate = employeeBase;
export const employeeUpdate = employeeBase.omit({ password: true }).partial();
export const resetPasswordSchema = z.object({ newPassword: password });
export const employeeStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export const balanceSchema = z.object({
  sick: z.number().min(0).optional(), earned: z.number().min(0).optional(), casual: z.number().min(0).optional(),
  compOff: z.number().min(0).optional(), maternity: z.number().min(0).optional(),
});

export { dateInput };

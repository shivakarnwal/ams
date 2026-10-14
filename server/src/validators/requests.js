import { z } from 'zod';
import { LEAVE_TYPES } from '../models/Leave.js';
import { REG_TYPES } from '../models/Regularization.js';
import { dateInput, dayString, phone, text, timeString } from './common.js';

/* ---------- Leave ---------- */
const leaveBase = z.object({
  leaveType: z.enum(LEAVE_TYPES, { errorMap: () => ({ message: 'Select a leave type' }) }),
  duration: z.enum(['full', 'first_half', 'second_half']).default('full'),
  startDate: dateInput('Start date'),
  endDate: dateInput('End date'),
  contactNumber: phone.optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
  reason: text('Reason', 1000, 3),
});
const leaveRules = (s) =>
  s
    .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'End date cannot be before start date' })
    .refine((v) => v.duration === 'full' || !v.startDate || !v.endDate || +v.startDate === +v.endDate, {
      path: ['endDate'], message: 'Half-day leave must start and end on the same date',
    });
export const leaveCreate = leaveRules(leaveBase);
export const leaveUpdate = leaveRules(leaveBase.partial().extend({ duration: z.enum(['full', 'first_half', 'second_half']).optional() }));

/* ---------- Comp-off ---------- */
export const compOffCreate = z.object({
  workDate: dateInput('Comp-off date'),
  dutyHours: z.coerce.number({ invalid_type_error: 'Duty hours must be a number' }).min(0.5, 'Duty hours must be at least 0.5').max(24, 'Duty hours cannot exceed 24'),
  appliedFor: z.enum(['full', 'half'], { errorMap: () => ({ message: 'Select Full Day or Half Day' }) }),
  reason: text('Reason', 1000, 3),
});
export const compOffUpdate = compOffCreate.partial();

/* ---------- Regularization ---------- */
const regBase = z.object({
  type: z.enum(REG_TYPES, { errorMap: () => ({ message: 'Select a regularization type' }) }),
  date: dayString,
  time: timeString.optional().or(z.literal('').transform(() => undefined)),
  reason: z.string().trim().max(1000).optional().default(''),
});
export const regularizationCreate = regBase.refine((v) => !['in-punch', 'out-punch'].includes(v.type) || v.time, {
  path: ['time'], message: 'Time is required for punch regularization',
});
export const regularizationUpdate = regBase.partial();

/* ---------- Visitor ---------- */
const visitorBase = z.object({
  visitorName: text('Visitor name', 120),
  company: z.string().trim().max(150).optional().default(''),
  contactNumber: phone.optional().default(''),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')).default(''),
  purpose: text('Purpose', 500, 3),
  visitDate: dateInput('Visit date'),
  expectedTime: timeString.optional().or(z.literal('').transform(() => undefined)),
  numberOfVisitors: z.coerce.number().int().min(1).max(50).optional().default(1),
});
export const visitorCreate = visitorBase;
export const visitorUpdate = visitorBase.partial();

/* ---------- Travel expense ---------- */
const travelBase = z.object({
  purpose: text('Purpose', 300, 3),
  fromLocation: text('From location', 150),
  toLocation: text('To location', 150),
  travelDate: dateInput('Travel date'),
  mode: z.enum(['bus', 'train', 'flight', 'taxi', 'own_vehicle', 'other']).default('other'),
  amount: z.coerce.number({ invalid_type_error: 'Amount must be a number' }).min(1, 'Amount must be greater than 0').max(10_000_000),
  description: z.string().trim().max(1000).optional().default(''),
});
export const travelCreate = travelBase;
export const travelUpdate = travelBase.partial().extend({ mode: z.enum(['bus', 'train', 'flight', 'taxi', 'own_vehicle', 'other']).optional() });

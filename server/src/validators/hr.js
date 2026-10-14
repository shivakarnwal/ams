import { z } from 'zod';
import { dateInput, dayString, objectId, optionalDate, phone, text, timeString } from './common.js';

/* ---------- Attendance ---------- */
export const attendanceManual = z
  .object({
    employee: objectId,
    date: dayString,
    inTime: timeString.optional().or(z.literal('').transform(() => undefined)),
    outTime: timeString.optional().or(z.literal('').transform(() => undefined)),
    status: z.enum(['present', 'absent', 'half_day', 'leave', 'holiday', 'weekly_off', 'wfh', 'on_duty']).default('present'),
    note: z.string().trim().max(300).optional().default(''),
  })
  .refine((v) => !v.inTime || !v.outTime || v.outTime > v.inTime, { path: ['outTime'], message: 'Out time must be after in time' });
export const attendanceManualUpdate = z
  .object({
    inTime: timeString.optional().or(z.literal('').transform(() => undefined)),
    outTime: timeString.optional().or(z.literal('').transform(() => undefined)),
    status: z.enum(['present', 'absent', 'half_day', 'leave', 'holiday', 'weekly_off', 'wfh', 'on_duty']).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => !v.inTime || !v.outTime || v.outTime > v.inTime, { path: ['outTime'], message: 'Out time must be after in time' });

/* ---------- Manpower requisition ---------- */
const manpowerBase = z.object({
  jobTitle: text('Job title', 150),
  startingDate: dateInput('Starting date'),
  department: text('Department', 100),
  designation: text('Designation', 100),
  location: text('Location', 100),
  reportingTo: z.preprocess((v) => (v === '' ? undefined : v), objectId.optional()),
  vacancies: z.coerce.number().int().min(1, 'At least 1 vacancy').max(500).default(1),
  justification: z.string().trim().max(1500).optional().default(''),
});
export const manpowerCreate = manpowerBase;
export const manpowerUpdate = manpowerBase.partial();

/* ---------- Candidate ---------- */
const candidateBase = z.object({
  requisition: z.preprocess((v) => (v === '' ? undefined : v), objectId.optional()),
  name: text('Candidate name', 120, 2),
  contact: phone.optional().default(''),
  email: z.string({ required_error: 'Email is required' }).trim().toLowerCase().email('Enter a valid email'),
  jobTitle: text('Job title', 150),
  startingDate: optionalDate('Starting date'),
});
export const candidateCreate = candidateBase;
export const candidateUpdate = candidateBase.partial();
export const candidateDecision = z
  .object({ decision: z.enum(['approve', 'reject']) });
export const candidateEvaluate = z.object({
  rating: z.coerce.number().int().min(1, 'Rating must be 1-5').max(5, 'Rating must be 1-5'),
  feedback: text('Feedback', 1500, 3),
  result: z.enum(['selected', 'rejected'], { errorMap: () => ({ message: 'Select a result' }) }),
});

/* ---------- Confirmation ---------- */
export const confirmationCreate = z.object({
  employee: objectId,
  probationEndDate: dateInput('Probation end date'),
  remarks: z.string().trim().max(1000).optional().default(''),
});
export const confirmationUpdate = confirmationCreate.omit({ employee: true }).partial();
export const confirmationReview = z
  .object({
    status: z.enum(['confirmed', 'extended', 'rejected']),
    extendedTill: optionalDate('Extension date'),
    remarks: z.string().trim().max(1000).optional().default(''),
  })
  .refine((v) => v.status !== 'extended' || v.extendedTill, { path: ['extendedTill'], message: 'Extension date is required' })
  .refine((v) => v.status !== 'rejected' || v.remarks.length >= 3, { path: ['remarks'], message: 'Please give a reason (min 3 characters)' });

/* ---------- Holiday / Announcement ---------- */
export const holidayCreate = z.object({
  name: text('Holiday name', 120),
  date: dateInput('Date'),
  description: z.string().trim().max(300).optional().default(''),
});
export const holidayUpdate = holidayCreate.partial();
export const announcementCreate = z.object({ title: text('Title', 200, 3), body: z.string().trim().max(3000).optional().default('') });
export const announcementUpdate = announcementCreate.partial();

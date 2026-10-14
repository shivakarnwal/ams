import { z } from 'zod';
import { OPTIONS } from '../models/profileOptions.js';

/**
 * One schema per profile section. Objects are .strict(): unknown keys are rejected, so an employee can never
 * smuggle e.g. `bank` or `role` into a section they are allowed to edit.
 * Forms send "" for an empty input: for plain text that clears the value, for dates/numbers it means "no value".
 */
const blank = (v) => (v === '' ? null : v);
const s = (max = 120) => z.string().trim().max(max, `Must be at most ${max} characters`);
const so = (max = 120) => s(max).optional();
const oneOf = (list, label) => z.preprocess((v) => (v === null ? '' : v), z.union([z.literal(''), z.enum(list, { errorMap: () => ({ message: `Choose a valid ${label}` }) })]));
const date = (label) =>
  z.preprocess((v) => {
    const b = blank(v);
    if (b === null || b === undefined) return b;
    const d = new Date(b);
    return Number.isNaN(d.getTime()) ? 'invalid' : d;
  }, z.date({ invalid_type_error: `${label} is invalid` }).nullable());
const num = (label, min, max) =>
  z.preprocess((v) => (blank(v) === null ? null : Number(v)), z.number({ invalid_type_error: `${label} must be a number` }).min(min, `${label} must be ${min}–${max}`).max(max, `${label} must be ${min}–${max}`).nullable());
const flag = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());
const re = (rx, msg, max = 30) => z.preprocess((v) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : v), z.union([z.literal(''), z.string().max(max).regex(rx, msg)]));
const phone = z.string().trim().refine((v) => v === '' || /^[0-9+\-\s()]{7,15}$/.test(v), 'Enter a valid phone number');
const email = z.string().trim().toLowerCase().refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email address');
const objectIdOrNull = z.preprocess(blank, z.string().regex(/^[a-f\d]{24}$/i, 'Invalid user').nullable());
const time = z.string().trim().refine((v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v), 'Use HH:mm');
/** Secret fields: omit to keep, "" or null to clear, a value to replace. */
const secret = (rx, msg) => z.preprocess((v) => (v === null ? '' : typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : v), z.union([z.literal(''), z.string().regex(rx, msg)]));
const year = new Date().getFullYear();

export const general = z
  .object({
    // personal
    title: oneOf(OPTIONS.titles, 'title'),
    firstName: z.string().trim().min(1, 'First name is required').max(60),
    middleName: s(60),
    lastName: s(60),
    gender: oneOf(OPTIONS.genders, 'gender'),
    dateOfBirth: date('Date of birth').refine((d) => !d || d < new Date(), 'Date of birth must be in the past'),
    maritalStatus: oneOf(OPTIONS.maritalStatuses, 'marital status'),
    bloodGroup: oneOf(OPTIONS.bloodGroups, 'blood group'),
    nationality: s(60),
    religion: s(60),
    birthPlace: s(80),
    stateOfBirth: s(60),
    countryOfBirth: s(60),
    // employment / organisation
    mobile: phone,
    designation: s(100),
    department: s(100),
    location: s(100),
    branch: s(100),
    dateOfJoining: date('Date of joining'),
    manager: objectIdOrNull,
    businessUnit: s(), company: s(), plant: s(), headquarters: s(), subDepartment: s(), division: s(), function: s(),
    grade: s(20),
    personType: oneOf(OPTIONS.personTypes, 'person type'),
    employmentCategory: oneOf(OPTIONS.employmentCategories, 'employment category'),
    costCenter: s(60),
    position: s(),
    groupDateOfJoining: date('Group date of joining'),
    shiftStart: time,
    shiftEnd: time,
    hod: objectIdOrNull,
    adminManager: objectIdOrNull,
  })
  .partial()
  .strict();

const addressSchema = z
  .object({
    line1: s(200), line2: s(200), city: s(80), district: s(80), state: s(60), country: s(60),
    pincode: z.string().trim().refine((v) => v === '' || /^\d{6}$/.test(v), 'Pincode must be 6 digits'),
  })
  .partial()
  .strict();

export const contact = z
  .object({
    personalEmail: email,
    personalMobile: phone,
    emergencyContactPerson: s(120),
    emergencyContactNo: phone,
    emergencyMedicalProblem: s(300),
    permanentAddress: addressSchema,
    correspondenceAddress: addressSchema,
    sameAsPermanent: z.boolean(),
  })
  .partial()
  .strict();

export const bank = z
  .object({
    bankName: s(),
    accountHolderName: s(),
    accountNumber: secret(/^\d{6,18}$/, 'Account number must be 6–18 digits'),
    ifsc: re(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid 11-character IFSC (e.g. SBIN0001234)', 11),
    branchName: s(),
    accountType: oneOf(OPTIONS.accountTypes, 'account type'),
  })
  .partial()
  .strict();

export const statutory = z
  .object({
    aadhaarNo: secret(/^\d{12}$/, 'Aadhaar number must be 12 digits'),
    panNo: secret(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN (e.g. ABCDE1234F)'),
    passportNo: secret(/^[A-Z0-9]{6,12}$/, 'Enter a valid passport number'),
    passportValidUpto: date('Passport validity'),
    uanNo: re(/^\d{12}$/, 'UAN must be 12 digits', 12),
    drivingLicence: re(/^[A-Z0-9-]{8,20}$/, 'Enter a valid driving licence number', 20),
    esiNo: re(/^\d{10,17}$/, 'ESI number must be 10–17 digits', 17),
    pfAccountNo: re(/^[A-Z0-9/]{5,26}$/, 'Enter a valid PF account number', 26),
    uniformStatus: oneOf(OPTIONS.uniformStatuses, 'uniform status'),
    uniformType: oneOf(OPTIONS.uniformTypes, 'uniform type'),
    extraUniform: oneOf(['Yes', 'No'], 'value'),
    attendanceInput: oneOf(OPTIONS.attendanceInputs, 'attendance input'),
    confirmationDate: date('Confirmation date'),
  })
  .partial()
  .strict();

const required = (label, max = 120) => z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);
const requiredDate = (label) => date(label).refine((d) => d !== null && d !== undefined, `${label} is required`);
const range = (from = 'fromDate', to = 'toDate') => (v) => !v[from] || !v[to] || v[to] >= v[from];

/** List-section rows. Sent as JSON or multipart (experience/education can carry one attachment). */
export const listItems = {
  experience: z
    .object({
      employer: required('Previous employer'),
      designation: required('Designation'),
      fromDate: requiredDate('From date'),
      toDate: requiredDate('To date'),
      location: so(), city: so(80),
      removeAttachment: flag.optional(),
    })
    .strict()
    .refine(range(), { path: ['toDate'], message: 'To date must be after from date' })
    .refine((v) => !v.toDate || v.toDate <= new Date(), { path: ['toDate'], message: 'To date cannot be in the future' }),
  education: z
    .object({
      level: z.preprocess(blank, z.enum(OPTIONS.educationLevels, { errorMap: () => ({ message: 'Level of education is required' }) })),
      certificate: required('Certificate', 60),
      fromDate: requiredDate('From date'),
      toDate: requiredDate('To date'),
      mode: z.preprocess(blank, z.enum(OPTIONS.educationModes, { errorMap: () => ({ message: 'Education / training type is required' }) })),
      institute: required('Institute / college', 150),
      passingYear: num('Passing year', 1950, year + 6).optional(),
      percentage: num('Passing %', 0, 100).optional(),
      grade: so(20), university: so(150), country: so(60),
      removeAttachment: flag.optional(),
    })
    .strict()
    .refine(range(), { path: ['toDate'], message: 'To date must be after from date' }),
  family: z
    .object({
      relationship: z.preprocess(blank, z.enum(OPTIONS.relationships, { errorMap: () => ({ message: 'Relationship type is required' }) })),
      name: required('Name'),
      gender: z.preprocess(blank, z.enum(OPTIONS.genders, { errorMap: () => ({ message: 'Gender is required' }) })),
      dateOfBirth: requiredDate('Date of birth').refine((d) => !d || d <= new Date(), 'Date of birth must be in the past'),
      university: so(150), qualification: so(), school: so(150), grade: so(20), placeOfBirth: so(80),
      passingYear: num('Passing year', 1930, year + 6).optional(),
      percentage: num('Passing %', 0, 100).optional(),
      dependent: flag.optional(),
      working: flag.optional(),
    })
    .strict(),
  languages: z
    .object({
      language: required('Language', 40),
      read: flag.optional(), write: flag.optional(), speak: flag.optional(),
    })
    .strict()
    .refine((v) => v.read || v.write || v.speak, { path: ['read'], message: 'Tick at least one of read, write or speak' }),
  hobbies: z
    .object({ sportType: so(40), culturalType: so(40), hobby: so(), others: so() })
    .strict()
    .refine((v) => v.sportType || v.culturalType || v.hobby || v.others, { path: ['hobby'], message: 'Fill in at least one field' }),
};

export const revealBody = z.object({ field: z.enum(['accountNumber', 'aadhaarNo', 'panNo', 'passportNo']) });
export const historyQuery = z.object({ page: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(50).optional() });

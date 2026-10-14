/** Dropdown values for the profile forms (served by GET /profiles/options; enums are also validated). */
export const OPTIONS = {
  titles: ['Mr.', 'Ms.', 'Mrs.', 'Dr.'],
  genders: ['Male', 'Female', 'Other', 'Prefer not to say'],
  maritalStatuses: ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'],
  bloodGroups: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  personTypes: ['Onroll', 'Offroll'],
  employmentCategories: ['Permanent', 'Probation', 'Contract', 'Trainee', 'Intern', 'Consultant'],
  accountTypes: ['Savings', 'Salary', 'Current'],
  relationships: ['Father', 'Mother', 'Spouse', 'Son', 'Daughter', 'Brother', 'Sister', 'Father-in-law', 'Mother-in-law', 'Other'],
  educationLevels: ['10th / Matriculation', '12th / Intermediate', 'ITI', 'Diploma', 'Graduate', 'Post Graduate', 'Doctorate', 'Certification'],
  certificates: ['SSC', 'HSC', 'ITI', 'Diploma', 'B.Tech / B.E.', 'B.Sc', 'B.Com', 'B.A.', 'BCA', 'BBA', 'M.Tech / M.E.', 'M.Sc', 'M.Com', 'M.A.', 'MCA', 'MBA', 'Ph.D', 'Professional Certificate', 'Other'],
  educationModes: ['Full Time', 'Part Time', 'Distance', 'Training'],
  languages: ['Hindi', 'English', 'Bengali', 'Marathi', 'Telugu', 'Tamil', 'Gujarati', 'Urdu', 'Kannada', 'Odia', 'Malayalam', 'Punjabi', 'Assamese', 'Sanskrit', 'Nepali', 'Other'],
  sportTypes: ['Cricket', 'Football', 'Badminton', 'Table Tennis', 'Volleyball', 'Basketball', 'Chess', 'Carrom', 'Athletics', 'Yoga', 'Swimming', 'Other'],
  culturalTypes: ['Music', 'Singing', 'Dance', 'Drama', 'Painting', 'Photography', 'Writing', 'Anchoring', 'Other'],
  uniformStatuses: ['Issued', 'Not Issued', 'Returned'],
  uniformTypes: ['Shirt & Trouser', 'T-Shirt', 'Safety Uniform', 'Coverall', 'Apron'],
  attendanceInputs: ['Biometric', 'Mobile App', 'Web', 'Manual'],
  documentTypes: [
    { value: 'voter_id', label: 'Voter ID' },
    { value: 'aadhaar', label: 'Aadhaar card' },
    { value: 'pan', label: 'PAN card' },
    { value: 'passport', label: 'Passport' },
    { value: 'driving_licence', label: 'Driving Licence' },
  ],
  countries: ['India', 'Nepal', 'Bhutan', 'Bangladesh', 'Sri Lanka', 'United Arab Emirates', 'United Kingdom', 'United States', 'Canada', 'Australia', 'Germany', 'Singapore', 'Other'],
  states: [
    'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh',
    'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  ],
};
export const DOCUMENT_TYPES = OPTIONS.documentTypes.map((d) => d.value);

/**
 * Who may change each profile section.
 *  hr   -> HR / Admin only (employees read-only)
 *  self -> the employee for their own profile, and HR / Admin
 */
export const SECTION_POLICY = {
  general: 'hr',
  bank: 'hr',
  statutory: 'hr',
  documents: 'hr',
  contact: 'self',
  experience: 'self',
  education: 'self',
  family: 'self',
  languages: 'self',
  hobbies: 'self',
};
export const LIST_SECTIONS = ['experience', 'education', 'family', 'languages', 'hobbies'];
/** Encrypted at rest, masked in responses, revealed only on request (audited). */
export const SECRET_FIELDS = { bank: ['accountNumber'], statutory: ['aadhaarNo', 'panNo', 'passportNo'] };

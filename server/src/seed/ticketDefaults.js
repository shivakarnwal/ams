import { TicketCategory, TicketPriority } from '../models/Ticket.js';

/**
 * Starter ticket categories and priorities. Inserted once, only when the collections are empty
 * (on server start and by the seed script); afterwards HR manages them under Ticket Settings.
 */

const sub = (name, issueTypes = []) => ({ name, issueTypes });

export const DEFAULT_CATEGORIES = [
  {
    name: 'IT',
    description: 'Hardware, software, accounts, network and IT security',
    subCategories: [
      sub('Admin Rights', ['Temporary admin access', 'Permanent admin access']),
      sub('Antivirus Support', ['Antivirus not updating', 'Threat detected', 'Antivirus installation']),
      sub('Application Errors'),
      sub('Application Support'),
      sub('Asset Request', ['Laptop', 'Desktop', 'Monitor', 'Keyboard / Mouse', 'Headset / Webcam', 'Mobile / SIM']),
      sub('Asset Return'),
      sub('Asset Tracking'),
      sub('Backup & Recovery', ['Restore deleted files', 'Backup setup', 'Backup failure']),
      sub('Data Loss Prevention (DLP)'),
      sub('Documentation Request'),
      sub('Email issues', ['Unable to send / receive', 'Mailbox full', 'Outlook not opening', 'Spam / phishing email', 'Distribution list request']),
      sub('Encryption'),
      sub('File/Folder Access', ['New access', 'Remove access', 'Shared drive access']),
      sub('Hardware Issues', ['Laptop', 'Desktop', 'Monitor', 'Keyboard / Mouse', 'Docking station', 'Headset / Webcam', 'Battery / Charger']),
      sub('Internet & Connectivity', ['No internet', 'Slow internet', 'Wi-Fi not connecting', 'LAN cable / port issue']),
      sub('IT Audit Support'),
      sub('IT Consultation'),
      sub('Left User Data Access'),
      sub('Loaner Asset Request'),
      sub('Miscellaneous'),
      sub('MS Teams Issue', ['Login issue', 'Audio / video issue', 'Team / channel request']),
      sub('Network Services'),
      sub('Password Management', ['Password reset', 'Account locked', 'MFA / OTP issue']),
      sub('Printer Access', ['Add printer', 'Printer not working', 'Scanner issue']),
      sub('Software Installation/Removal', ['Install software', 'Uninstall software', 'License request']),
      sub('Software Updates'),
      sub('Suspicious Activity', ['Phishing email', 'Unusual login', 'Malware suspected']),
      sub('System Issues', ['Slow system', 'Blue screen / crash', 'Not booting', 'Disk space full']),
      sub('USB Access'),
      sub('User Account Management', ['New user account', 'Disable account', 'Access change']),
      sub('VPN Access', ['New VPN access', 'VPN not connecting', 'VPN slow']),
    ],
  },
  {
    name: 'HR',
    description: 'Policies, letters, records, onboarding, exit and grievances',
    subCategories: [
      sub('Policy Clarification'),
      sub('Letters & Certificates', ['Experience letter', 'Address proof letter', 'Employment verification', 'NOC']),
      sub('Employee Records Update', ['Personal details', 'Bank details', 'Emergency contact', 'Documents']),
      sub('Onboarding'),
      sub('Exit & Full and Final'),
      sub('Grievance'),
      sub('Insurance & Benefits'),
      sub('Other HR Query'),
    ],
  },
  {
    name: 'Payroll',
    description: 'Salary, slips, reimbursements and tax',
    subCategories: [
      sub('Salary Discrepancy'),
      sub('Salary Slip'),
      sub('Reimbursement'),
      sub('Tax / Form 16 / Declarations'),
      sub('Bank Account Update'),
      sub('Other Payroll Query'),
    ],
  },
  {
    name: 'Attendance',
    description: 'Punches, regularization and devices',
    subCategories: [sub('Punch-in / Punch-out Issue'), sub('Regularization Query'), sub('Biometric Device Issue'), sub('Shift / Roster')],
  },
  {
    name: 'Leave',
    description: 'Balances, approvals and leave policy',
    subCategories: [sub('Leave Balance'), sub('Leave Approval Delay'), sub('Leave Policy Query'), sub('Comp Off')],
  },
  {
    name: 'Facilities',
    description: 'Workplace, housekeeping, cafeteria, transport and access',
    subCategories: [
      sub('Seating / Workstation'),
      sub('Housekeeping'),
      sub('Cafeteria'),
      sub('Electrical / Maintenance'),
      sub('Air Conditioning'),
      sub('Transport'),
      sub('Access Card'),
      sub('Other Facilities Request'),
    ],
  },
  { name: 'Other', description: 'Anything that does not fit above', subCategories: [sub('General Query'), sub('Feedback / Suggestion')] },
];

export const DEFAULT_PRIORITIES = [
  { name: 'Low', level: 1, color: 'slate' },
  { name: 'Normal', level: 2, color: 'blue', isDefault: true },
  { name: 'High', level: 3, color: 'amber' },
  { name: 'Critical', level: 4, color: 'red' },
];

export async function ensureTicketDefaults() {
  const [cats, pris] = await Promise.all([TicketCategory.estimatedDocumentCount(), TicketPriority.estimatedDocumentCount()]);
  if (!cats) await TicketCategory.insertMany(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, order: i })));
  if (!pris) await TicketPriority.insertMany(DEFAULT_PRIORITIES);
}

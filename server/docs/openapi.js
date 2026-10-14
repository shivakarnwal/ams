// OpenAPI 3.0 description of the API. Served at /api/docs (Swagger UI) and /api/openapi.json.
const bearer = [{ bearerAuth: [] }];
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } },
];
const q = (name, extra = {}) => ({ name, in: 'query', schema: { type: 'string', ...extra } });
const err = (d) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const ok = (d = 'OK') => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } });
const common = { 401: err('Missing/invalid token'), 403: err('Forbidden'), 422: err('Validation failed') };
const body = (props = {}, req = []) => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', required: req, properties: props } } },
});
const s = { type: 'string' }, n = { type: 'number' }, d = { type: 'string', format: 'date' };

const fileProp = { type: 'string', format: 'binary' };
const mp = (properties, required = []) => ({ required: true, content: { 'multipart/form-data': { schema: { type: 'object', required, properties } } } });
const MP_POLICY = mp({ file: fileProp, title: s, category: s, description: s, effectiveDate: d, version: s, changeNote: s }, ['file', 'title', 'category']);
const MP_VERSION = mp({ file: fileProp, version: s, effectiveDate: d, changeNote: s }, ['file']);
const MP_TICKET = mp({ category: s, subCategory: s, issueType: s, priority: s, relatedAsset: s, subject: s, description: s, attachments: { type: 'array', items: fileProp } }, ['category', 'subCategory', 'subject', 'description']);
const MP_COMMENT = mp({ body: s, internal: { type: 'boolean' }, attachments: { type: 'array', items: fileProp } });

const WHO = { name: 'userId', in: 'path', required: true, description: '"me" or an employee id (HR/Admin)', schema: s };
const op = (tag, summary, extra = {}) => ({ tags: [tag], summary, security: bearer, responses: { 200: ok(), ...common }, ...extra });

/** list / stats / get / create / update / review / cancel / delete for a request-style resource */
function requestResource(tag, base, createProps, createReq, reviewEnum, filters = []) {
  return {
    [base]: {
      get: op(tag, `List ${tag} (scope=me|team|all)`, { parameters: [...pageParams, q('scope', { enum: ['me', 'team', 'all'] }), q('status'), q('from'), q('to'), q('employeeId'), ...filters.map((f) => q(f))] }),
      post: op(tag, `Create ${tag}`, { requestBody: body(createProps, createReq), responses: { 201: ok('Created'), 409: err('Conflict'), ...common } }),
    },
    [`${base}/stats`]: { get: op(tag, `Counts by status for ${tag}`, { parameters: [q('scope'), q('employeeId')] }) },
    [`${base}/{id}`]: {
      get: op(tag, `Get one ${tag}`, { parameters: [idParam] }),
      put: op(tag, `Update a pending ${tag}`, { parameters: [idParam], requestBody: body(createProps) }),
      patch: op(tag, `Update a pending ${tag}`, { parameters: [idParam], requestBody: body(createProps) }),
      delete: op(tag, `Delete (owner while pending, admin always)`, { parameters: [idParam] }),
    },
    [`${base}/{id}/status`]: {
      patch: op(tag, `Review: ${reviewEnum.join(' / ')} (manager of owner, hr, admin)`, {
        parameters: [idParam],
        requestBody: body({ status: { type: 'string', enum: reviewEnum }, remarks: s }, ['status']),
        responses: { 200: ok(), 409: err('Invalid transition'), ...common },
      }),
    },
    [`${base}/{id}/cancel`]: { patch: op(tag, `Cancel ${tag} (owner)`, { parameters: [idParam], responses: { 200: ok(), 409: err('Cannot cancel'), ...common } }) },
  };
}

export const openapi = {
  openapi: '3.0.3',
  info: { title: 'HR Admin Panel API', version: '1.0.0', description: 'REST API (Node.js, Express, MongoDB). All responses are JSON: `{ success, data, message?, meta? }` or `{ success:false, message, errors? }`.' },
  servers: [{ url: '/api/v1' }],
  tags: ['Health', 'Auth', 'Dashboard', 'Employees', 'Attendance', 'Leaves', 'CompOffs', 'Regularizations', 'Visitors', 'TravelExpenses', 'Manpower', 'Candidates', 'Confirmations', 'SalarySlips', 'Content', 'Gallery', 'Policies', 'Tickets', 'TicketSettings', 'Profiles', 'AppraisalLetters', 'Form16'].map((name) => ({ name })),
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', properties: { success: { type: 'boolean', example: false }, message: s, errors: { type: 'object', additionalProperties: s } } },
      Success: { type: 'object', properties: { success: { type: 'boolean', example: true }, data: {}, message: s, meta: { type: 'object', properties: { page: n, limit: n, total: n, pages: n } } } },
    },
  },
  paths: {
    '/health': { get: { tags: ['Health'], summary: 'Liveness', responses: { 200: ok() } } },
    '/ready': { get: { tags: ['Health'], summary: 'Readiness (checks MongoDB)', responses: { 200: ok('Ready'), 503: err('Database unavailable') } } },

    '/auth/login': { post: { tags: ['Auth'], summary: 'Sign in', requestBody: body({ email: s, password: s, device_id: s }, ['email', 'password']), responses: { 200: { description: '`{ success, token, user }`' }, 401: err('Invalid credentials'), 403: err('Account inactive'), 422: err('Validation failed') } } },
    '/auth/register': { post: { tags: ['Auth'], summary: 'Self sign-up (only if ALLOW_PUBLIC_SIGNUP=true)', requestBody: body({ name: s, email: s, password: s, contact: s }, ['name', 'email', 'password']), responses: { 201: { description: 'Created' }, 403: err('Disabled'), 409: err('Email exists'), 422: err('Validation failed') } } },
    '/auth/me': { get: op('Auth', 'Current user') },
    '/auth/profile': { put: op('Auth', 'Update own profile', { requestBody: body({ name: s, contact: s, address: s, avatar: s, dateOfBirth: d }) }), patch: op('Auth', 'Update own profile', { requestBody: body({ name: s, contact: s, address: s }) }) },
    '/auth/change-password': { post: op('Auth', 'Change password (revokes old tokens, returns new token)', { requestBody: body({ currentPassword: s, newPassword: s }, ['currentPassword', 'newPassword']) }) },
    '/auth/logout': { post: op('Auth', 'Revoke all tokens of the user') },

    '/dashboard': { get: op('Dashboard', 'Dashboard aggregates (balances, holidays, announcements, pending approvals)') },

    '/employees': {
      get: op('Employees', 'Directory (hr/admin see full records)', { parameters: [...pageParams, q('q'), q('code'), q('name'), q('department'), q('designation'), q('location'), q('role'), q('status', { enum: ['active', 'inactive'] })] }),
      post: op('Employees', 'Create employee (hr/admin; only admin can create hr/admin)', { requestBody: body({ employeeCode: s, name: s, email: s, password: s, role: { type: 'string', enum: ['employee', 'manager', 'hr', 'admin'] }, designation: s, department: s, location: s, branch: s, contact: s, dateOfJoining: d, manager: s }, ['employeeCode', 'name', 'email', 'password']), responses: { 201: ok(), 409: err('Duplicate'), ...common } }),
    },
    '/employees/filters': { get: op('Employees', 'Distinct departments / designations / locations') },
    '/employees/team-chart': { get: op('Employees', 'Manager, direct reports and peers of the current user') },
    '/employees/{id}': {
      get: op('Employees', 'Get employee', { parameters: [idParam] }),
      put: op('Employees', 'Update employee (hr/admin)', { parameters: [idParam], requestBody: body({ name: s, designation: s, department: s, role: s, manager: s }) }),
      patch: op('Employees', 'Update employee (hr/admin)', { parameters: [idParam], requestBody: body({ name: s, designation: s, department: s, role: s, manager: s }) }),
      delete: op('Employees', 'Delete employee and their records (admin)', { parameters: [idParam] }),
    },
    '/employees/{id}/status': { patch: op('Employees', 'Activate / deactivate (hr/admin)', { parameters: [idParam], requestBody: body({ status: { type: 'string', enum: ['active', 'inactive'] } }, ['status']) }) },
    '/employees/{id}/leave-balance': { patch: op('Employees', 'Adjust leave balances (hr/admin)', { parameters: [idParam], requestBody: body({ sick: n, earned: n, casual: n, compOff: n, maternity: n }) }) },
    '/employees/{id}/reset-password': { post: op('Employees', 'Reset password (hr/admin)', { parameters: [idParam], requestBody: body({ newPassword: s }, ['newPassword']) }) },

    '/attendance': {
      get: op('Attendance', 'Month records', { parameters: [q('month', { example: '2026-10' }), q('scope'), q('employeeId')] }),
      post: op('Attendance', 'Manual record (hr/admin)', { requestBody: body({ employee: s, date: d, inTime: s, outTime: s, status: s, note: s }, ['employee', 'date']) }),
    },
    '/attendance/today': { get: op('Attendance', "Today's record") },
    '/attendance/summary': { get: op('Attendance', 'Weekly progress, 6-month duty hours, month counts', { parameters: [q('month'), q('employeeId')] }) },
    '/attendance/punch-in': { post: op('Attendance', 'Punch in', { responses: { 201: ok(), 409: err('Already punched in'), ...common } }) },
    '/attendance/punch-out': { post: op('Attendance', 'Punch out', { responses: { 200: ok(), 400: err('Not punched in'), 409: err('Already punched out'), ...common } }) },
    '/attendance/{id}': {
      put: op('Attendance', 'Edit record (hr/admin)', { parameters: [idParam], requestBody: body({ inTime: s, outTime: s, status: s, note: s }) }),
      delete: op('Attendance', 'Delete record (admin)', { parameters: [idParam] }),
    },

    '/leaves/balance': { get: op('Leaves', 'Balances and days used this year', { parameters: [q('employeeId')] }) },
    ...requestResource('Leaves', '/leaves', { leaveType: { type: 'string', enum: ['sick', 'earned', 'casual', 'comp_off', 'maternity'] }, duration: { type: 'string', enum: ['full', 'first_half', 'second_half'] }, startDate: d, endDate: d, contactNumber: s, address: s, reason: s }, ['leaveType', 'startDate', 'endDate', 'reason'], ['approved', 'rejected'], ['leaveType']),
    ...requestResource('CompOffs', '/comp-offs', { workDate: d, dutyHours: n, appliedFor: { type: 'string', enum: ['full', 'half'] }, reason: s }, ['workDate', 'dutyHours', 'appliedFor', 'reason'], ['approved', 'rejected']),
    ...requestResource('Regularizations', '/regularizations', { type: { type: 'string', enum: ['in-punch', 'out-punch', 'on-duty', 'wfh'] }, date: d, time: s, reason: s }, ['type', 'date'], ['approved', 'rejected'], ['type']),
    ...requestResource('Visitors', '/visitors', { visitorName: s, company: s, contactNumber: s, email: s, purpose: s, visitDate: d, expectedTime: s, numberOfVisitors: n }, ['visitorName', 'purpose', 'visitDate'], ['approved', 'rejected']),
    ...requestResource('TravelExpenses', '/travel-expenses', { purpose: s, fromLocation: s, toLocation: s, travelDate: d, mode: s, amount: n, description: s }, ['purpose', 'fromLocation', 'toLocation', 'travelDate', 'amount'], ['approved', 'rejected', 'paid'], ['mode']),

    '/manpower-requisitions': {
      get: op('Manpower', 'List (manager/hr/admin)', { parameters: [...pageParams, q('status'), q('department'), q('location'), q('q'), q('from'), q('to')] }),
      post: op('Manpower', 'Create requisition', { requestBody: body({ jobTitle: s, startingDate: d, department: s, designation: s, location: s, reportingTo: s, vacancies: n, justification: s }, ['jobTitle', 'startingDate', 'department', 'designation', 'location']) }),
    },
    '/manpower-requisitions/{id}': { get: op('Manpower', 'Get', { parameters: [idParam] }), put: op('Manpower', 'Update pending', { parameters: [idParam], requestBody: body({ jobTitle: s }) }), patch: op('Manpower', 'Update pending', { parameters: [idParam], requestBody: body({ jobTitle: s }) }), delete: op('Manpower', 'Delete', { parameters: [idParam] }) },
    '/manpower-requisitions/{id}/status': { patch: op('Manpower', 'approved / rejected / closed (hr/admin)', { parameters: [idParam], requestBody: body({ status: { type: 'string', enum: ['approved', 'rejected', 'closed'] }, remarks: s }, ['status']) }) },

    '/candidates': { get: op('Candidates', 'List', { parameters: [...pageParams, q('stage', { enum: ['request', 'interview', 'closed'] }), q('status'), q('q'), q('requisition')] }), post: op('Candidates', 'Add candidate', { requestBody: body({ name: s, email: s, contact: s, jobTitle: s, startingDate: d, requisition: s }, ['name', 'email', 'jobTitle']) }) },
    '/candidates/{id}': { put: op('Candidates', 'Update (request stage)', { parameters: [idParam], requestBody: body({ name: s }) }), patch: op('Candidates', 'Update (request stage)', { parameters: [idParam], requestBody: body({ name: s }) }), delete: op('Candidates', 'Delete (hr/admin)', { parameters: [idParam] }) },
    '/candidates/{id}/decision': { patch: op('Candidates', 'Approve → interview stage / reject (hr/admin)', { parameters: [idParam], requestBody: body({ decision: { type: 'string', enum: ['approve', 'reject'] } }, ['decision']) }) },
    '/candidates/{id}/evaluate': { patch: op('Candidates', 'Interview evaluation', { parameters: [idParam], requestBody: body({ rating: { type: 'integer', minimum: 1, maximum: 5 }, feedback: s, result: { type: 'string', enum: ['selected', 'rejected'] } }, ['rating', 'feedback', 'result']) }) },

    '/confirmations': { get: op('Confirmations', 'List (scope=me|team|all)', { parameters: [...pageParams, q('scope'), q('status')] }), post: op('Confirmations', 'Create (manager/hr/admin)', { requestBody: body({ employee: s, probationEndDate: d, remarks: s }, ['employee', 'probationEndDate']) }) },
    '/confirmations/{id}': { get: op('Confirmations', 'Get', { parameters: [idParam] }), put: op('Confirmations', 'Update pending', { parameters: [idParam], requestBody: body({ probationEndDate: d }) }), patch: op('Confirmations', 'Update pending', { parameters: [idParam], requestBody: body({ probationEndDate: d }) }), delete: op('Confirmations', 'Delete (hr/admin)', { parameters: [idParam] }) },
    '/confirmations/{id}/status': { patch: op('Confirmations', 'confirmed / extended / rejected (hr/admin)', { parameters: [idParam], requestBody: body({ status: { type: 'string', enum: ['confirmed', 'extended', 'rejected'] }, extendedTill: d, remarks: s }, ['status']) }) },

    '/salary-slips/my': { get: op('SalarySlips', 'Own salary slips, newest first (meta.years lists years that have slips)', { parameters: [q('year')] }) },
    '/salary-slips': {
      get: op('SalarySlips', 'All slips (hr/admin)', { parameters: [...pageParams, q('employee'), q('q'), q('month'), q('year')] }),
      post: op('SalarySlips', 'Upload a PDF for an employee/month/year (hr/admin). multipart/form-data', {
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['employee', 'month', 'year', 'file'], properties: { employee: s, month: { type: 'integer', minimum: 1, maximum: 12 }, year: { type: 'integer' }, note: s, file: { type: 'string', format: 'binary' } } } } } },
        responses: { 201: ok('Created'), 409: err('Slip already exists for that period'), 413: err('File too large'), ...common },
      }),
    },
    '/salary-slips/{id}': {
      get: op('SalarySlips', 'Metadata (owner, hr, admin; others get 404)', { parameters: [idParam] }),
      put: op('SalarySlips', 'Replace the PDF (hr/admin). multipart/form-data', { parameters: [idParam], requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { note: s, file: { type: 'string', format: 'binary' } } } } } } }),
      delete: op('SalarySlips', 'Delete (hr/admin)', { parameters: [idParam] }),
    },
    '/salary-slips/{id}/download': { get: { tags: ['SalarySlips'], summary: 'Stream the decrypted PDF (owner, hr, admin; others get 404). ?inline=true to display', security: bearer, parameters: [idParam, q('inline', { enum: ['true', 'false'] })], responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, 404: err('Not found'), ...common } } },

    '/holidays': { get: op('Content', 'List holidays', { parameters: [...pageParams, q('year'), q('upcoming', { enum: ['true'] })] }), post: op('Content', 'Add holiday (hr/admin)', { requestBody: body({ name: s, date: d, description: s }, ['name', 'date']) }) },
    '/holidays/{id}': { put: op('Content', 'Update (hr/admin)', { parameters: [idParam], requestBody: body({ name: s, date: d }) }), delete: op('Content', 'Delete (hr/admin)', { parameters: [idParam] }) },
    '/announcements': { get: op('Content', 'List announcements', { parameters: pageParams }), post: op('Content', 'Publish (hr/admin)', { requestBody: body({ title: s, body: s }, ['title']) }) },
    '/announcements/{id}': { put: op('Content', 'Update (hr/admin)', { parameters: [idParam], requestBody: body({ title: s, body: s }) }), delete: op('Content', 'Delete (hr/admin)', { parameters: [idParam] }) },

    '/gallery/stats': { get: op('Gallery', 'Totals: albums, photos, uploads in the last 7 days (+ storageBytes for hr/admin)') },
    '/gallery/albums': {
      get: op('Gallery', 'List albums with photoCount and cover URLs (meta.years lists event years)', { parameters: [...pageParams, q('q'), q('year'), q('sort', { enum: ['newest', 'oldest', 'name', 'updated'] })] }),
      post: op('Gallery', 'Create album (hr/admin)', { requestBody: body({ name: s, description: s, eventDate: d }, ['name']), responses: { 201: ok('Created'), ...common } }),
    },
    '/gallery/albums/{id}': {
      get: op('Gallery', 'Get album', { parameters: [idParam] }),
      put: op('Gallery', 'Update album / set cover (hr/admin)', { parameters: [idParam], requestBody: body({ name: s, description: s, eventDate: d, coverPhoto: { type: 'string', nullable: true } }) }),
      patch: op('Gallery', 'Update album / set cover (hr/admin)', { parameters: [idParam], requestBody: body({ name: s, description: s, eventDate: d, coverPhoto: { type: 'string', nullable: true } }) }),
      delete: op('Gallery', 'Delete album and all of its photos (hr/admin)', { parameters: [idParam] }),
    },
    '/gallery/albums/{id}/photos': {
      post: op('Gallery', 'Upload ONE photo into the album (hr/admin). multipart/form-data: file (JPG/PNG/WebP/GIF) + optional preview (~1600px) and thumb (~480px) renditions', {
        parameters: [idParam],
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, preview: { type: 'string', format: 'binary' }, thumb: { type: 'string', format: 'binary' }, caption: s } } } } },
        responses: { 201: ok('Created'), 413: err('File too large'), ...common },
      }),
    },
    '/gallery/photos': { get: op('Gallery', 'List photos, newest first. Each item has signed urls.thumb / preview / original / download', { parameters: [...pageParams, q('album'), q('q'), q('sort', { enum: ['newest', 'oldest'] })] }) },
    '/gallery/photos/bulk-delete': { post: op('Gallery', 'Delete up to 100 photos (hr/admin)', { requestBody: body({ ids: { type: 'array', items: s } }, ['ids']) }) },
    '/gallery/photos/{id}': {
      get: op('Gallery', 'Get photo', { parameters: [idParam] }),
      put: op('Gallery', 'Edit caption / move to another album (hr/admin)', { parameters: [idParam], requestBody: body({ caption: s, album: s }) }),
      patch: op('Gallery', 'Edit caption / move to another album (hr/admin)', { parameters: [idParam], requestBody: body({ caption: s, album: s }) }),
      delete: op('Gallery', 'Delete photo (hr/admin)', { parameters: [idParam] }),
    },
    '/gallery/photos/{id}/file': {
      get: {
        tags: ['Gallery'],
        summary: 'Image bytes. No bearer token: authorised by the signed query string from a photo\'s `urls`. download=1 sends it as an attachment',
        parameters: [idParam, q('v', { enum: ['thumb', 'preview', 'original'] }), q('exp'), q('sig'), q('download', { enum: ['0', '1'] })],
        responses: { 200: { description: 'Image', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } }, 304: { description: 'Not modified' }, 403: err('Invalid or expired signature'), 404: err('Not found') },
      },
    },
    '/policies/stats': { get: op('Policies', 'Totals: folders, files (policies), versions, updatedRecently (30 days)') },
    '/policies/categories': {
      get: op('Policies', 'Folders with policyCount, totalSize, lastUpdated'),
      post: op('Policies', 'Create folder (hr/admin)', { requestBody: body({ name: s, description: s, color: { type: 'string', enum: ['blue', 'purple', 'orange', 'sky', 'green', 'rose', 'amber', 'slate'] } }, ['name']), responses: { 201: ok('Created'), 409: err('Name taken'), ...common } }),
    },
    '/policies/categories/{id}': {
      patch: op('Policies', 'Rename / recolour folder (hr/admin)', { parameters: [idParam], requestBody: body({ name: s, description: s, color: s }) }),
      delete: op('Policies', 'Delete an EMPTY folder (hr/admin)', { parameters: [idParam], responses: { 200: ok(), 409: err('Folder not empty'), ...common } }),
    },
    '/policies': {
      get: op('Policies', 'List policies with current version', { parameters: [...pageParams, q('category'), q('q'), q('sort', { enum: ['updated', 'title', 'effective'] })] }),
      post: op('Policies', 'Upload a policy as version 1.0 (hr/admin). multipart: file (PDF/Word/Excel/PowerPoint/JPG/PNG)', { requestBody: MP_POLICY, responses: { 201: ok('Created'), 409: err('Duplicate title in folder'), 413: err('Too large'), ...common } }),
    },
    '/policies/{id}': {
      get: op('Policies', 'Policy with all versions (newest first)', { parameters: [idParam] }),
      patch: op('Policies', 'Edit title / folder / description / effective date (hr/admin)', { parameters: [idParam], requestBody: body({ title: s, category: s, description: s, effectiveDate: d }) }),
      delete: op('Policies', 'Delete policy and every version (hr/admin)', { parameters: [idParam] }),
    },
    '/policies/{id}/versions': { post: op('Policies', 'Replace = upload a new version that becomes current (hr/admin). multipart: file, version, effectiveDate, changeNote', { parameters: [idParam], requestBody: MP_VERSION, responses: { 201: ok('Created'), 409: err('Version label taken'), ...common } }) },
    '/policies/{id}/versions/{versionId}': { delete: op('Policies', 'Delete an older version (not the current one) (hr/admin)', { parameters: [idParam, { name: 'versionId', in: 'path', required: true, schema: s }] }) },
    '/policies/{id}/download': { get: { tags: ['Policies'], summary: 'Download the current (or ?version=) document. ?inline=true previews PDFs/images', security: bearer, parameters: [idParam, q('version'), q('inline', { enum: ['true', 'false'] })], responses: { 200: { description: 'File', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, 404: err('Not found'), ...common } } },

    '/tickets/meta': { get: op('Tickets', 'Active categories (sub categories + issue types), priorities, statuses, limits; assignees for hr/admin') },
    '/tickets/stats': { get: op('Tickets', 'Counts by status (scope=me|all; all = hr/admin, adds unassigned / assignedToMe / createdToday)', { parameters: [q('scope', { enum: ['me', 'all'] })] }) },
    '/tickets': {
      get: op('Tickets', 'List tickets. scope=me (own) | all (hr/admin)', { parameters: [...pageParams, q('scope', { enum: ['me', 'all'] }), q('status'), q('priority'), q('category'), q('employee'), q('assignee'), q('from', { format: 'date' }), q('to', { format: 'date' }), q('q'), q('sort', { enum: ['newest', 'oldest', 'updated', 'priority'] })] }),
      post: op('Tickets', 'Raise a ticket. multipart: category, subCategory, issueType?, priority?, relatedAsset?, subject, description, attachments[]', { requestBody: MP_TICKET, responses: { 201: ok('Created'), 413: err('Too large'), ...common } }),
    },
    '/tickets/{id}': { get: op('Tickets', 'Ticket + conversation + audit trail (internal notes for hr/admin only). Owner or hr/admin; others 404', { parameters: [idParam] }) },
    '/tickets/{id}/comments': { post: op('Tickets', 'Reply (owner or hr/admin) or internal note (internal=true, hr/admin). multipart: body, internal, attachments[]', { parameters: [idParam], requestBody: MP_COMMENT, responses: { 201: ok('Created'), 409: err('Ticket closed'), ...common } }) },
    '/tickets/{id}/assign': { patch: op('Tickets', 'Assign to an HR/Admin user, or null to unassign (hr/admin)', { parameters: [idParam], requestBody: body({ assignee: { type: 'string', nullable: true } }, ['assignee']) }) },
    '/tickets/{id}/status': { patch: op('Tickets', 'Change status / close / reopen; optional note is posted to the conversation (hr/admin)', { parameters: [idParam], requestBody: body({ status: { type: 'string', enum: ['open', 'assigned', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled'] }, note: s }, ['status']) }) },
    '/tickets/{id}/priority': { patch: op('Tickets', 'Change priority (hr/admin)', { parameters: [idParam], requestBody: body({ priority: s }, ['priority']) }) },
    '/tickets/{id}/cancel': { patch: op('Tickets', 'Owner withdraws an active ticket', { parameters: [idParam], requestBody: body({ reason: s }) }) },
    '/tickets/{id}/attachments/{attachmentId}': { get: { tags: ['Tickets'], summary: 'Download an attachment (?inline=true for images/PDF)', security: bearer, parameters: [idParam, { name: 'attachmentId', in: 'path', required: true, schema: s }, q('inline', { enum: ['true', 'false'] })], responses: { 200: { description: 'File' }, 404: err('Not found'), ...common } } },
    '/tickets/settings/categories': {
      get: op('TicketSettings', 'All categories incl. inactive, with ticketCount (hr/admin)'),
      post: op('TicketSettings', 'Create category (hr/admin)', { requestBody: body({ name: s, description: s, active: { type: 'boolean' }, subCategories: { type: 'array', items: { type: 'object', properties: { name: s, active: { type: 'boolean' }, issueTypes: { type: 'array', items: s } } } } }, ['name', 'subCategories']) }),
    },
    '/tickets/settings/categories/{id}': {
      patch: op('TicketSettings', 'Update / activate / deactivate (hr/admin)', { parameters: [idParam], requestBody: body({ name: s, active: { type: 'boolean' } }) }),
      delete: op('TicketSettings', 'Delete an unused category (hr/admin)', { parameters: [idParam], responses: { 200: ok(), 409: err('In use'), ...common } }),
    },
    '/tickets/settings/priorities': {
      get: op('TicketSettings', 'All priorities with ticketCount (hr/admin)'),
      post: op('TicketSettings', 'Create priority (hr/admin)', { requestBody: body({ name: s, level: n, color: s, isDefault: { type: 'boolean' }, active: { type: 'boolean' } }, ['name', 'level']) }),
    },
    '/tickets/settings/priorities/{id}': {
      patch: op('TicketSettings', 'Update priority (hr/admin)', { parameters: [idParam], requestBody: body({ name: s, level: n, isDefault: { type: 'boolean' } }) }),
      delete: op('TicketSettings', 'Delete an unused, non-default priority (hr/admin)', { parameters: [idParam] }),
    },
    '/profiles/options': { get: op('Profiles', 'Dropdown values + section edit policy (people list for hr/admin)') },
    '/profiles/{userId}': { get: op('Profiles', 'Full profile. Secrets masked; permissions per section (edit|view). Employees: own only (others 404)', { parameters: [WHO] }) },
    '/profiles/{userId}/general': { put: op('Profiles', 'Personal + employment details (hr/admin; HR cannot edit own or other HR/Admin)', { parameters: [WHO], requestBody: body({ firstName: s, lastName: s, gender: s, dateOfBirth: d, bloodGroup: s, designation: s, grade: s, hod: s }) }) },
    '/profiles/{userId}/contact': { put: op('Profiles', 'Contact + addresses (self-service)', { parameters: [WHO], requestBody: body({ personalEmail: s, personalMobile: s, permanentAddress: { type: 'object' }, correspondenceAddress: { type: 'object' }, sameAsPermanent: { type: 'boolean' } }) }) },
    '/profiles/{userId}/bank': { put: op('Profiles', 'Bank details (hr/admin). accountNumber: omit = keep, "" = clear, value = replace (encrypted)', { parameters: [WHO], requestBody: body({ bankName: s, accountHolderName: s, accountNumber: s, ifsc: s, branchName: s, accountType: s }) }) },
    '/profiles/{userId}/statutory': { put: op('Profiles', 'Other details: Aadhaar/PAN/passport (encrypted), UAN, ESI, PF, uniform… (hr/admin)', { parameters: [WHO], requestBody: body({ aadhaarNo: s, panNo: s, passportNo: s, uanNo: s }) }) },
    '/profiles/{userId}/{section}': { post: op('Profiles', 'Add a row to experience|education|family|languages|hobbies (self-service). JSON or multipart with optional `attachment` (experience/education)', { parameters: [WHO, { name: 'section', in: 'path', required: true, schema: { type: 'string', enum: ['experience', 'education', 'family', 'languages', 'hobbies'] } }] }) },
    '/profiles/{userId}/{section}/{itemId}': {
      put: op('Profiles', 'Edit a row (removeAttachment=true drops its file)', { parameters: [WHO, { name: 'section', in: 'path', required: true, schema: s }, { name: 'itemId', in: 'path', required: true, schema: s }] }),
      delete: op('Profiles', 'Remove a row', { parameters: [WHO, { name: 'section', in: 'path', required: true, schema: s }, { name: 'itemId', in: 'path', required: true, schema: s }] }),
    },
    '/profiles/{userId}/documents/{type}': {
      put: op('Profiles', 'Upload/replace an ID document (voter_id|aadhaar|pan|passport|driving_licence) — multipart `file` (hr/admin)', { parameters: [WHO, { name: 'type', in: 'path', required: true, schema: s }] }),
      delete: op('Profiles', 'Remove an ID document (hr/admin)', { parameters: [WHO, { name: 'type', in: 'path', required: true, schema: s }] }),
    },
    '/profiles/{userId}/files/{fileId}': { get: { tags: ['Profiles'], summary: 'Download a profile file (owner or hr/admin)', security: bearer, parameters: [WHO, { name: 'fileId', in: 'path', required: true, schema: s }, q('inline')], responses: { 200: { description: 'File' }, 404: err('Not found'), ...common } } },
    '/profiles/{userId}/reveal': { post: op('Profiles', 'Full value of a masked field (owner or hr/admin). Audited', { parameters: [WHO], requestBody: body({ field: { type: 'string', enum: ['accountNumber', 'aadhaarNo', 'panNo', 'passportNo'] } }, ['field']) }) },
    '/profiles/{userId}/history': { get: op('Profiles', 'Audit trail: who changed / viewed which fields (never values)', { parameters: [WHO, ...pageParams] }) },

    // Performance Appraisal Letters — employees: own records only (others 404); hr/admin: everything
    '/appraisal-letters/options': { get: op('AppraisalLetters', 'Appraisal types and ratings') },
    '/appraisal-letters/my': { get: op('AppraisalLetters', 'Own letters, newest first (meta.years lists years that have letters)', { parameters: [...pageParams, q('year'), q('month')] }) },
    '/appraisal-letters': {
      get: op('AppraisalLetters', 'All letters (hr/admin). q matches employee name / code / email and title', { parameters: [...pageParams, q('employee'), q('q'), q('year'), q('month'), q('appraisalType')] }),
      post: op('AppraisalLetters', 'Add a letter (hr/admin). multipart/form-data, PDF only', {
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['employee', 'title', 'year', 'month', 'file'], properties: { employee: s, title: s, appraisalType: { type: 'string', enum: ['annual', 'mid_year', 'quarterly', 'probation', 'promotion', 'special'] }, year: { type: 'integer' }, month: { type: 'integer', minimum: 1, maximum: 12 }, effectiveDate: d, rating: { type: 'string', enum: ['outstanding', 'exceeds', 'meets', 'needs_improvement', 'unsatisfactory'] }, remarks: s, file: { type: 'string', format: 'binary' } } } } } },
        responses: { 201: ok('Created'), 409: err('A letter of that type already exists for the employee and period'), 413: err('File too large'), ...common },
      }),
    },
    '/appraisal-letters/{id}': {
      get: op('AppraisalLetters', 'Metadata (owner, hr, admin; others get 404)', { parameters: [idParam] }),
      put: op('AppraisalLetters', 'Edit any field and/or replace the PDF (hr/admin). multipart/form-data; "" clears effectiveDate / rating', { parameters: [idParam] }),
      delete: op('AppraisalLetters', 'Delete (hr/admin)', { parameters: [idParam] }),
    },
    '/appraisal-letters/{id}/download': { get: { tags: ['AppraisalLetters'], summary: 'Decrypted PDF (owner, hr, admin; others get 404). ?inline=true to display', security: bearer, parameters: [idParam, q('inline', { enum: ['true', 'false'] })], responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, 404: err('Not found'), ...common } } },

    // Form 16 — Part A and Part B are separate records (one of each per employee and financial year)
    '/form16/options': { get: op('Form16', 'Parts and selectable financial years') },
    '/form16/my': { get: op('Form16', 'Own certificates (meta.financialYears, meta.partCounts)', { parameters: [...pageParams, q('part', { enum: ['A', 'B'] }), q('fyStart')] }) },
    '/form16': {
      get: op('Form16', 'All certificates (hr/admin). q matches employee name / code / email and certificate no.', { parameters: [...pageParams, q('employee'), q('q'), q('part', { enum: ['A', 'B'] }), q('fyStart')] }),
      post: op('Form16', 'Add Part A or Part B (hr/admin). multipart/form-data, PDF only. fyStart 2025 = FY 2025-26', {
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['employee', 'part', 'fyStart', 'file'], properties: { employee: s, part: { type: 'string', enum: ['A', 'B'] }, fyStart: { type: 'integer' }, certificateNo: s, employerTan: s, issueDate: d, remarks: s, file: { type: 'string', format: 'binary' } } } } } },
        responses: { 201: ok('Created'), 409: err('That part already exists for the employee and financial year'), 413: err('File too large'), ...common },
      }),
    },
    '/form16/{id}': {
      get: op('Form16', 'Metadata (owner, hr, admin; others get 404)', { parameters: [idParam] }),
      put: op('Form16', 'Edit and/or replace the PDF (hr/admin). multipart/form-data', { parameters: [idParam] }),
      delete: op('Form16', 'Delete (hr/admin)', { parameters: [idParam] }),
    },
    '/form16/{id}/download': { get: { tags: ['Form16'], summary: 'Decrypted PDF (owner, hr, admin; others get 404). ?inline=true to display', security: bearer, parameters: [idParam, q('inline', { enum: ['true', 'false'] })], responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, 404: err('Not found'), ...common } } },
  },
};

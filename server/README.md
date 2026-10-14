# HR Admin Panel API (Node.js · Express · MongoDB)

REST API under `/api/v1`. JSON envelope: `{ success, data, message?, meta? }` / `{ success:false, message, errors? }`.

## Run
```bash
cp .env.example .env      # MONGODB_URI, JWT_SECRET (32+ chars in production), CORS_ORIGINS
npm install
npm run seed              # demo data  (npm run seed -- --reset wipes first)
npm run dev               # or: npm start
npm test                  # TEST_MONGODB_URI=mongodb://... or in-memory mongod
```
Docker (API + MongoDB 7): `JWT_SECRET=<long-random> docker compose up --build`

## Docs & health
- Swagger UI `/api/docs`, spec `/api/openapi.json` (always on in dev; in production set `ENABLE_DOCS=true`)
- `GET /api/v1/health` liveness · `GET /api/v1/ready` readiness (MongoDB connected)
- Every response has `X-Request-Id` (echoes the incoming one).

## Layout
`src/config` env + db · `models` Mongoose schemas · `validators` zod · `middleware` auth, validate, error ·
`controllers` + `routes` · `utils` access control, time, helpers · `seed` · `docs/openapi.js` · `tests`

## Salary slips
`/api/v1/salary-slips` — see the root README. Encrypted at rest (AES-256-GCM, `SALARY_ENCRYPTION_KEY`), owner-or-HR/Admin access, PDF-only uploads.

## Photo gallery
`/api/v1/gallery` — albums and photos. Every signed-in user can view and download; **only `hr` and `admin` can create, edit, upload or delete** (`authorize('hr','admin')`, checked before the upload is parsed). Employees and managers get `403`.

| Method | Path | Who |
| --- | --- | --- |
| GET | `/gallery/stats`, `/gallery/albums`, `/gallery/albums/:id`, `/gallery/photos`, `/gallery/photos/:id` | everyone |
| POST / PATCH / DELETE | `/gallery/albums`, `/gallery/albums/:id` (PATCH `coverPhoto` sets the cover) | hr, admin |
| POST | `/gallery/albums/:id/photos` — multipart, ONE photo per request: `file` (+ optional `preview`, `thumb`, `caption`) | hr, admin |
| PATCH / DELETE | `/gallery/photos/:id` (caption, move with `album`), `POST /gallery/photos/bulk-delete` | hr, admin |
| GET | `/gallery/photos/:id/file?v=thumb\|preview\|original&exp&sig[&download=1]` | holder of a signed URL |

- **Storage:** bytes live in MongoDB GridFS (bucket `galleryFiles`) — no disk volume needed; deleting a photo/album deletes its files.
- **Image URLs:** `<img>` tags can't send the bearer token, so list/get responses include `urls.thumb/preview/original/download` signed with an HMAC derived from `JWT_SECRET`. Each URL grants one size of one photo and expires after 1–2 × `GALLERY_URL_TTL_HOURS` (default 6). Rotating `JWT_SECRET` invalidates them.
- **Validation:** type is detected from the bytes (JPEG/PNG/WebP/GIF only; SVG and anything else is rejected), max `GALLERY_MAX_MB` (default 15) per file.
- **Renditions:** the web app makes a ~1600px preview and ~480px thumbnail in the browser before upload, so no native image library is needed on the server. If they're missing, the original is served for every size.

## HR policies
`/api/v1/policies` — folders (`/categories`) of policy documents. Everyone signed in can browse, preview (`/:id/download?inline=true`, PDFs/images) and download; **only `hr`/`admin` can create, edit, version or delete**.
- **Versioning:** "replace" uploads a new version (`POST /:id/versions`) that becomes current; older versions stay downloadable (`?version=<id>`) and can be deleted, the current one cannot. Labels are free text (`2.1`) or auto `n.0`.
- **Files:** PDF, Word, Excel, PowerPoint, JPG/PNG, detected from the bytes *and* the extension; max `POLICY_MAX_MB` (20). Stored in GridFS bucket `policyFiles`.
- Non-empty folders cannot be deleted (409).

## Support tickets
`/api/v1/tickets` — employees raise tickets (Category → Sub category → Issue type, priority, optional related asset, subject, description, attachments), see their own (`scope=me`), reply and cancel their active tickets. **HR/Admin** see all (`scope=all`, filters: status/`active`, priority, category, employee, assignee=`me|unassigned|<id>`, `from`/`to`, `q`), assign to HR/Admin users, change status/priority, add internal notes and manage settings under `/tickets/settings/*`.
- **Lifecycle:** `open → assigned → in_progress → pending → resolved → closed` (+ `cancelled`). Assigning an open ticket makes it `assigned`; an employee reply to a `pending` ticket moves it to `in_progress`; HR can reopen resolved/closed/cancelled tickets. Closed/cancelled tickets accept internal notes only.
- **Audit:** every change is an append-only `TicketEvent`; internal notes and their events are never returned to employees. Other people's tickets return 404.
- **Numbers:** `TKT-<year>-00001`, from an atomic counter.
- **Defaults:** categories (IT with 31 sub categories, HR, Payroll, Attendance, Leave, Facilities, Other) and priorities (Low, Normal*, High, Critical) are inserted on first start when the collections are empty.
- **Attachments:** images, PDF, Word, Excel, txt/csv/log; `TICKET_MAX_FILES` (5) × `TICKET_ATTACHMENT_MAX_MB` (10) per message; GridFS bucket `ticketFiles`.

## Employee profiles (My Profile)
`/api/v1/profiles/:userId` (`me` or an id). Employees and managers only ever reach their own profile (anyone else's returns 404); HR/Admin can open every profile.
- **Who edits what** (`SECTION_POLICY` in `models/profileOptions.js`): `general` (personal + employment), `bank`, `statutory` (Aadhaar/PAN/passport/UAN/ESI/PF…) and ID `documents` are **HR/Admin only**; `contact`, `experience`, `education`, `family`, `languages`, `hobbies` are self-service (HR/Admin can edit them too). Every section schema is `.strict()`, so other fields cannot be smuggled in.
- **Separation of duties:** like Employee Management, only an Admin may change HR-managed data of HR/Admin accounts — HR cannot edit its own bank or personal details.
- **Sensitive values** (`accountNumber`, `aadhaarNo`, `panNo`, `passportNo`) are AES-256-GCM encrypted per user+field (key derived from `SALARY_ENCRYPTION_KEY`), returned masked (`XXXX XXXX 1234`) and revealed only via `POST /:userId/reveal`, which is audited.
- **Audit:** every change and reveal is recorded in `ProfileAudit` (field names only, never values) — `GET /:userId/history`.
- `PUT /auth/profile` no longer lets non-admins change `name` / `dateOfBirth`.

## Performance Appraisal Letters & Form 16
`/api/v1/appraisal-letters` and `/api/v1/form16` share one engine (`controllers/employeeDocController.js`).

| Action | Employee / Manager | HR | Admin |
| --- | --- | --- | --- |
| `GET /my` (filters: PAL `year`, `month` · Form 16 `part`, `fyStart`) | own records | own | own |
| `GET /:id`, `GET /:id/download` | own records — any other id is **404** | all | all |
| `GET /` (search `q`, filters, pagination) | 403 | ✅ | ✅ |
| `POST /`, `PUT /:id` (metadata and/or new PDF), `DELETE /:id` | 403 | ✅ | ✅ |

- **PAL:** one letter per employee + year + month + appraisal type (`annual`, `mid_year`, `quarterly`, `probation`, `promotion`, `special`); title, optional rating, effective date and remarks.
- **Form 16:** Part A and Part B are separate records; one of each per employee and financial year (`fyStart` 2025 = FY 2025-26 / AY 2026-27). Optional certificate no., employer TAN, issue date and remarks. A future financial year is rejected.
- Files must be real PDFs (extension + magic bytes), max `SALARY_SLIP_MAX_MB`. They are encrypted at rest with AES-256-GCM (`SALARY_ENCRYPTION_KEY`), bound to their record id, and never serialised. Downloads are `no-store` and sandboxed.
- `uploadedBy`, `updatedBy`, `createdAt`, `updatedAt`, `fileReplacedAt`, `downloadCount` and `lastDownloadedAt` are kept on every record. Deleting an employee deletes their letters and certificates.
- The seed adds clearly marked sample documents for the demo employee.

## Security & quality
helmet, CORS allow-list, login/register rate limit, bcrypt(12), JWT with server-side revocation (`tokenVersion`),
role + ownership checks on every route, zod validation with per-field errors, Mongo-operator rejection,
1 MB body limit, atomic status transitions, graceful shutdown, `npm audit` clean.
Roles: `employee` < `manager` < `hr` < `admin` (see the root README for the endpoint table).

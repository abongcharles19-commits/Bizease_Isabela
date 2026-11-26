# Barangay Bungahin Information Management System

A responsive barangay administration dashboard with resident and household directory, certificate request tracking, community announcements, and an SMS delivery queue. After staff sign in, resident, household, certificate request, and announcement data are loaded from and saved to MySQL through the PHP API.

## Run the dashboard

From this project folder:

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`). Keep XAMPP Apache and MySQL running so the dashboard can reach the PHP API and database.

Keep XAMPP Apache and MySQL running while signing in. The current workspace has an Admin and Staff account. To add accounts on another installation, run these commands from PowerShell in the project folder. Each command prompts for a password (minimum 10 characters):

```powershell
C:\xampp\php\php.exe api\create_user.php admin "Barangay Administrator" admin
C:\xampp\php\php.exe api\create_user.php staff "Barangay Staff" staff
C:\xampp\php\php.exe api\create_user.php resident "Resident Name" resident BRG-2026-ABC123
```

Create the resident record before the resident account, then replace `BRG-2026-ABC123` with that resident's actual resident code. Resident logins only see their own profile and certificate requests. Admin and staff accounts use the staff dashboard. User passwords are stored as PHP password hashes. Do not use a shared/default password when deploying.

To change a password later, run `C:\xampp\php\php.exe api\reset_user_password.php <username>` and enter a new password with at least 16 characters.

## Set up MySQL on XAMPP

1. Start **Apache** and **MySQL** in the XAMPP Control Panel.
2. Open phpMyAdmin at `http://localhost/phpmyadmin`.
3. Import `database.sql` (it creates the `barangay_bungahin` database and tables).
4. Copy `api/config.php` to `api/config.local.php` and set your database username/password. `config.local.php` is ignored by Git.
5. Put this project under XAMPP's `htdocs` (it is already at `C:\xampp\htdocs\barangay_bungahin` in this workspace). The API health check is `http://localhost/barangay_bungahin/api/index.php?resource=health`.

For a database created before role support, import `database_migration_roles.sql` once after the latest `database.sql` changes. It adds the resident role and links resident accounts to their resident record.

For an existing database, import `database_migration_documents.sql` once to enable the administrator document register. New database installations receive the `documents` table from `database.sql`. The **Documents** page is available to Admin accounts and records document title, type, date, description, and status (Draft, Implemented, or Archived). An optional PDF attachment can be uploaded (up to 10 MB); attachments are stored under `api/storage/documents` and are downloadable only by an authenticated Admin.

For an existing database, also import `database_migration_resident_login.sql` once before registering residents with login accounts. New installations receive the nullable unique email column from `database.sql`. When staff add a resident, they must enter a unique email and a temporary password of at least 10 characters. The resident can then sign in with that email and password; the server stores only a password hash. Existing resident edits do not reset account credentials. Staff should give temporary passwords to residents through a private channel.

Admin, Secretary, and Staff users can edit a resident's login email from the resident edit form. A linked account's password can be replaced by entering a new password (minimum 10 characters); leave that field blank to keep the current password. If a legacy resident has no linked login yet, authorized staff can create one from the same form by entering both an email and password.

For an existing database, import `database_migration_certificate_sms.sql` once to link SMS log entries to certificate requests. New installations include this relationship in `database.sql`. Each time staff change a request status, the system sends a short transactional SMS to the resident's valid registered mobile number through TextBee and records the result. This status alert uses the resident's registered phone; the SMS opt-in is used for bulk announcements. If the number is missing/invalid or TextBee is not configured or rejects the request, the status still saves and the SMS result is shown to staff and recorded when a number is available. TextBee acceptance means queued by the provider, not confirmed handset delivery. Configure TextBee before changing request statuses; failed status alerts are not automatically retried.

For existing databases, import `database_migration_pickup_estimate.sql` once to store estimated certificate pickup dates. Staff can set or clear an estimated pickup date from the **Certificate Requests** table. Residents see the date and a live day countdown in **My certificate requests**; when no estimate has been entered, the portal says the date is not set. This is a staff-entered estimate, not an automatic processing-time guarantee. When the status becomes Ready for pickup, the portal says the certificate is available now.

### Local setup status

For this workspace, XAMPP MariaDB is running, the role migration has been applied, and `api/config.local.php` is configured with the default local XAMPP `root` account (empty password). A clearly marked `Demo Resident` profile (`DEMO-2026-001`) is linked to the local Resident login; SMS consent is off. Keep using your local credentials; `config.local.php` is excluded from Git.

- PHP API health: `http://localhost/barangay_bungahin/api/index.php?resource=health`
- phpMyAdmin: `http://localhost/phpmyadmin`
- Vite dashboard: `http://localhost:5173/`

## API endpoints

All API requests use JSON and live at `api/index.php?resource=...`.

| Method | Resource | Use |
| --- | --- | --- |
| GET | `health` | Check database connection |
| GET, POST | `documents` | Admin-only document register and PDF upload |
| GET | `document-file&id=...` | Admin-only private PDF download |
| GET | `auth` | Get the signed-in user (session cookie required) |
| POST | `auth` | Sign in or out using JSON `{"action":"login","username":"email-or-username","password":"..."}` or `{"action":"logout"}` |
| GET | `residents` | List residents; optional `&q=search` |
| POST | `residents` | Create resident profile and linked resident login account |
| PATCH / DELETE | `residents&id=ID` | Edit or remove resident |
| GET / POST | `requests` | List or create certificate request |
| PATCH | `requests&id=ID` | Change request status |
| GET / POST | `announcements` | List or create announcement and queue opted-in recipients |

Example create resident JSON:

```json
{
  "resident_code": "BRG-2026-001",
  "first_name": "Juan",
  "last_name": "Dela Cruz",
  "purok": "Purok 1",
  "phone": "09XXXXXXXXX",
  "email": "resident@example.com",
  "password": "use-a-private-password-here",
  "sms_opt_in": 0
}
```

Resident registration creates the linked resident login in the same database transaction as the resident record. Residents enter their email in the login page's **Email or username** field. Existing Admin and Staff accounts continue to sign in with their usernames.

## SMS setup

Announcements use [TextBee](https://textbee.dev/), a free-tier SMS gateway that sends through an Android phone and its SIM. The phone must stay online and the SIM/carrier plan may charge for SMS. TextBee currently lists one active device, 50 messages/day, and 300/month on its free plan; check its current [plans](https://textbee.dev/) before sending.

1. Install TextBee on an Android phone, register/pair it with your TextBee account, and create an API key in the TextBee dashboard. The free service requires an Android phone with a working SIM.
2. Edit the ignored local file `api/config.local.php` and enter the credentials:

   ```php
   'textbee_api_key' => 'YOUR_TEXTBEE_API_KEY',
   'textbee_device_id' => 'YOUR_PAIRED_DEVICE_ID',
   ```

   The device ID is optional when your TextBee account has a single active device. Keep the API key on the PHP server; never put it in React or commit it to Git. `TEXTBEE_API_KEY` and `TEXTBEE_DEVICE_ID` environment variables can also be used.
3. In the application, save an announcement. It sends to residents with SMS consent enabled and valid phone numbers. Philippine mobile numbers such as `09XXXXXXXXX` are converted to `+639XXXXXXXXX` for TextBee.

The API saves the announcement and recipient logs in MySQL first. TextBee's accepted response is recorded as a gateway batch ID while the logs remain queued, because acceptance does not confirm handset delivery. Failures and invalid phone numbers are recorded in `sms_logs`. Without credentials, messages remain queued and the dashboard reports that TextBee still needs configuration. This integration sends new announcements; older queued logs are not automatically retried. Review opt-in consent and the provider's live limits before sending to a large group. See the [TextBee send API documentation](https://textbee.dev/docs/sending-sms/sending-sms) for current request behavior.

## Before deployment

The API uses PHP sessions and requires sign-in for data routes. It is still a local development foundation: add role-specific authorization, CSRF protection, rate limits, audit logs, and SMS dispatch before public deployment. Use HTTPS and a dedicated MySQL user with limited privileges instead of the XAMPP `root` account outside local development.
# Bizease_Isabela

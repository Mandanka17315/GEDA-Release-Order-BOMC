# GEDA RO Tool – Baroda O&M Circle

Web app for solar rooftop Release Orders. Data is stored on Supabase. The site is hosted free on GitHub Pages.

- **Field offices** open the link with no login. They see the **Pending Release** list, enter the meter installation date or a reason, and click Save. They can also download the Pendency Excel and use the GEDA charges calculator.
- **Admin** clicks **Admin login**. After login, the admin gets Dashboard, Release Order (Word RO), Pending, Charges and Settings: import, full Master download and rates.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.css`, `js/` | The app |
| `config.js` | Your Supabase URL and anon key (edit this) |
| `lib/` | Supabase, SheetJS and JSZip libraries (kept here so no CDN is needed) |
| `supabase/schema.sql` | Database tables, security rules and field-office functions |

## Setup (about 20 minutes, once)

### 1. Create the Supabase project
1. Go to https://supabase.com, sign up and click **New project**. The Free plan is enough. Choose region **Mumbai (ap-south-1)**.
2. When it is ready, open **SQL Editor › New query**. Paste the whole of `supabase/schema.sql` and click **Run**.
3. Open **Authentication › Users › Add user › Create new user**. Enter your e-mail and a strong password. Tick *Auto confirm user*.
4. Back in **SQL Editor**, run this line with your own e-mail:
   ```sql
   insert into public.admins (email) values ('your.email@example.com');
   ```
   Only e-mails in this table can work as admin. Repeat the same line for any other admin.
5. Recommended: open **Authentication › Sign In / Providers** and turn **off** "Allow new users to sign up".

### 2. Put the keys in `config.js`
Open **Project Settings › API** (or **API Keys**). Copy:
- **Project URL** into `SUPABASE_URL`
- **anon / public** key into `SUPABASE_ANON_KEY`

Never use the `service_role` / secret key in this file.

### 3. Publish on GitHub Pages
1. On GitHub, click **New repository**, e.g. `geda-ro-tool`. Choose Public; GitHub Pages on the free plan needs a public repository.
2. Click **Add file › Upload files**. Drag in everything from this folder, including `lib`, `js` and `supabase`, then click **Commit**.
3. Open **Settings › Pages**. Under **Source**, choose *Deploy from a branch*, then `main` and `/ (root)`. Click **Save**.
4. After a minute the site is at `https://<your-user>.github.io/geda-ro-tool/`.

Share that link with the field offices. For yourself, `…/geda-ro-tool/#admin` opens the login box directly.

### 4. Move your existing data (admin, once)
Log in as admin and open **Settings › Import Master File from Excel**. Choose *Master File for GEDA Applications.xlsx*. This uploads the Master, GEDA FORMAT and SDN Code sheets.

## Daily use
- **New portal download:** Settings › Update portal data.
- **New RO:** Release Order › type the application number › fill in › **Save & download RO**.
- **Full backup in Excel:** Settings › **Download full Master file**. It has the Master, GEDA FORMAT, Pendency and SDN Code sheets.
- **Who changed what:** Dashboard › Recent updates. Every field entry is logged with the name entered.

## Security notes
- The field link has no password, as chosen. Field users cannot read or change the tables directly. They can only:
  - see the pending list (`pending_list`), and
  - add a meter date or reason to a row that is still *Pending* (`field_update`).
- Released or cancelled rows cannot be touched from the field link.
- Portal data (mobile numbers, e-mails) is visible only to admins.
- On the Free plan, Supabase pauses a project after about a week with no use. Opening the site regularly keeps it active. If it pauses, click **Restore** in the Supabase dashboard.

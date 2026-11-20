# Deploy Goodhands as a shared website

The site uses Supabase for shared bookings, queue updates, shop settings, and owner authentication. Vercel hosts the static customer and owner pages.

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com/) and save its database password somewhere private.
2. Open **SQL Editor**, create a new query, paste in `supabase-schema.sql`, and run it.
3. In **Authentication → Providers → Email**, disable **Allow new users to sign up**. Then, in **Authentication → Users**, add the owner's account with an email and password.
4. In SQL Editor, replace the placeholder owner email with the exact email used for that account, then run:

   ```sql
   update public.goodhands_app_state
   set owner_email = lower('owner@example.com')
   where id = true;
   ```

5. In **Authentication → URL Configuration**, set **Site URL** to your deployed Vercel origin (for example, `https://your-shop.vercel.app`). Add `https://your-shop.vercel.app/owner.html` to the allowed **Redirect URLs**. Add your local development URL separately if needed.
6. In **Project Settings → API**, copy the Project URL and the `anon`/publishable key. Put them into `supabase-config.js`:

   ```js
   window.GOODHANDS_SUPABASE = {
     url: "https://your-project-id.supabase.co",
     anonKey: "your-public-anon-or-publishable-key"
   };
   ```

   The anon/publishable key is intended to be visible in a website. Never put the `service_role` or secret key in this file or in frontend code.

Use **Forgot password?** on the deployed `/owner.html` page to request a reset. Its recovery link returns to the owner page, where you can enter and confirm the new password. If you change the auth URL settings, request a new email; old links may already be expired.

## 2. Deploy on Vercel

1. Push the updated project to the `main` branch on GitHub.
2. Sign in at [vercel.com](https://vercel.com/) and choose **Add New → Project**.
3. Import `shanoobsha/GOODHANDS`.
4. Select **Other** as the framework preset, leave the build command empty, and set the output directory to `.` (the project root). Choose a hosting plan whose terms allow use by a business.
5. Deploy. The resulting `*.vercel.app` address is the public website. `/owner.html` is the owner dashboard.
6. To use a custom domain, add it under the Vercel project's **Settings → Domains**, then follow Vercel's DNS instructions.

## 3. Check before sharing

- Open the public site and submit a test booking.
- Open `/owner.html` on a different device, sign in with the Supabase owner account, and confirm the same booking appears.
- Change shop hours and confirm the public page updates.
- Delete the test booking from the owner dashboard by completing it.
- Keep the owner password private and enable multi-factor authentication on the Supabase account.

Bookings from the old browser-only version are not migrated automatically. The new database starts with an empty queue.

## Security notes

- Customer pages receive only queue fields; customer names and phone numbers are available only to the authenticated owner.
- The database table is not directly accessible from the browser; its SQL functions enforce public booking validation and owner authorization.
- The public booking form does not yet include CAPTCHA or abuse rate limiting. Add bot protection before advertising the site broadly.
- This setup is suitable for a small shop launch, but monitor Supabase/Vercel usage and keep backups of the database.

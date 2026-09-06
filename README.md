# Utulivu — demo

A working demo of the Utulivu hospitality management system: three portals
(Operator, Provider, Guest) in one React app. All data is in-memory for
this demo — nothing persists to a database yet.

## Run it locally

```bash
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173).

## Deploy it for a trial (Vercel)

1. Push this folder to a GitHub repository.
2. Go to https://vercel.com, sign in, click "Add New Project".
3. Import the GitHub repo. Vercel auto-detects Vite — leave the defaults.
4. Click "Deploy". You'll get a live URL (e.g. utulivu.vercel.app) in
   under a minute.
5. Every time you push a change to GitHub, Vercel redeploys automatically.

## Deploy it for a trial (Netlify)

1. Push this folder to a GitHub repository.
2. Go to https://netlify.com → "Add new site" → "Import an existing project".
3. Pick the repo. Build command: `npm run build`. Publish directory: `dist`.
4. Deploy — you'll get a live URL (e.g. utulivu.netlify.app).

## Custom domain

Once deployed, both Vercel and Netlify let you attach a purchased domain
(e.g. utulivu.co.tz) under the project's Domain settings.

## Known limitations (demo, not production)

- No backend — all data resets when the page is refreshed or reopened
  in a new tab/browser.
- No real authentication — the provider login and guest access codes
  are for demonstration only.
- To run a trial where a real business enters real guests and bookings
  that persist over days, you'd need to add a backend (e.g. Supabase or
  Firebase) to replace the in-memory state.

# Setting up the Opportunities admin (Decap CMS)

This gives you a real admin page at `danmuzata.github.io/admin/` — log in
with GitHub, fill in a form (title, photo, description, deadline), hit
publish, and it commits straight to the repo. Only GitHub accounts with
write access to this repo can ever log in successfully; GitHub enforces that
during login itself.

What's already built (no action needed):
- `admin/index.html` / `admin/config.yml` — the CMS itself and its schema
  for the Opportunities list
- `admin/oauth-worker.js` — the OAuth relay code
- `data/opportunities.json` — where entries get stored
- `opportunities.html` — reads that file and renders cards, computing each
  entry's status (Open / Closing Soon / Closed) from its deadline
  automatically

What's left — needs your GitHub account, so it can't be done for you:

## 1. Create a GitHub OAuth App

Go to **github.com/settings/developers → OAuth Apps → New OAuth App**, and
fill in:
- **Application name**: anything, e.g. "Danny Muzata Site Admin"
- **Homepage URL**: `https://danmuzata.github.io`
- **Authorization callback URL**: `https://<your-worker-subdomain>.workers.dev/callback`
  (you won't know the exact Worker URL until step 2 — come back and edit
  this field afterward, GitHub lets you update it anytime)

After creating it, GitHub shows a **Client ID** and lets you generate a
**Client Secret**. Keep both handy for step 2 — never paste the secret into
chat with me or anywhere public.

## 2. Deploy the OAuth relay (Cloudflare Worker, free tier)

1. Install the Cloudflare CLI if you don't have it: `npm install -g wrangler`
2. `wrangler login` (opens a browser to authorize)
3. From this repo: `wrangler deploy admin/oauth-worker.js --name danmuzata-cms-auth --compatibility-date 2026-09-17`
4. Set the two secrets (it'll prompt for the value, typed locally, never
   sent through this chat):
   ```
   wrangler secret put GITHUB_CLIENT_ID --name danmuzata-cms-auth
   wrangler secret put GITHUB_CLIENT_SECRET --name danmuzata-cms-auth
   ```
5. Note the Worker URL `wrangler deploy` prints (something like
   `https://danmuzata-cms-auth.<your-subdomain>.workers.dev`)

## 3. Wire it together

1. Go back to the GitHub OAuth App (step 1) and set the callback URL to
   `<your-worker-url>/callback`
2. Edit `admin/config.yml` in this repo: replace
   `base_url: https://REPLACE-WITH-YOUR-OAUTH-RELAY-URL` with your actual
   Worker URL (no trailing slash, no `/callback` — just the base)
3. Commit and push

## 4. Try it

Visit `https://danmuzata.github.io/admin/`, click "Login with GitHub", and
you should land in the CMS. Add a test opportunity, publish, and confirm it
shows up on `/opportunities.html` after the commit lands.

If login fails, the browser console on `/admin/` and the Cloudflare Worker's
live logs (`wrangler tail --name danmuzata-cms-auth`) are the two places to
look first.

# VAT Portal — Production Deploy (internalportal.nationwideadvance.com)

## Architecture

| Component        | Port              | pm2 name     |
|------------------|-------------------|--------------|
| FastAPI backend  | `127.0.0.1:8006`  | `vateam-api` |
| Next.js frontend | `127.0.0.1:3011`  | `vateam-web` |

**nginx** (`deploy/nginx-watermark.conf` → `/etc/nginx/sites-available/watermark`):

- `/api/*` → FastAPI backend
- `/_next/static/*` → Next.js (long cache)
- everything else → Next.js

Public URL: **https://internalportal.nationwideadvance.com**

Legacy redirect: `watermark.solutions90.com` → new domain

---

## Deploy (manual)

From the server:

```bash
REPO_DIR=/home/sawaiz/vaTeam-WebPage bash /home/sawaiz/vaTeam-WebPage/deploy/update.sh --branch=master
```

`deploy/update.sh` will:

1. `git fetch` + `reset --hard` to the target branch
2. Create/update `backend/.venv` and install Python deps
3. `npm ci` + `next build` in `frontend/`
4. Reload pm2 (`vateam-api`, `vateam-web`) as user **sawaiz**
5. Copy nginx config and `reload nginx` (via sudo if needed)

**Automatic deploy:** push to `master` (or `main`) — GitHub Actions runs the same script over SSH.

---

## pm2 commands

Run as **sawaiz** (pm2 daemon owner):

```bash
sudo -u sawaiz pm2 status
sudo -u sawaiz pm2 logs vateam-web    # frontend
sudo -u sawaiz pm2 logs vateam-api     # backend
sudo -u sawaiz pm2 restart vateam-web vateam-api
```

After changing `ecosystem.config.js`:

```bash
sudo -u sawaiz bash -c 'cd /home/sawaiz/vaTeam-WebPage && pm2 startOrReload ecosystem.config.js && pm2 save'
```

---

## Git + SSH (if cloning/pulling as another user)

**Dubious ownership** (repo under `/home/sawaiz/`, running as another user):

```bash
git config --global --add safe.directory /home/sawaiz/vaTeam-WebPage
```

**Permission denied on `.git/`** — fix ownership:

```bash
sudo chown -R sawaiz:sawaiz /home/sawaiz/vaTeam-WebPage
```

**Remote uses `github-vateam` host alias** — add to `~/.ssh/config`:

```ssh
Host github-vateam
  HostName github.com
  User git
  IdentityFile ~/.ssh/vateam_deploy
  IdentitiesOnly yes
```

Deploy key lives on the server at `/home/sawaiz/.ssh/vateam_deploy`.

---

## Verify after deploy

```bash
curl -s https://internalportal.nationwideadvance.com/api/health    # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://internalportal.nationwideadvance.com/login
curl -s -o /dev/null -w '%{http_code}\n' https://internalportal.nationwideadvance.com/submit
```

In browser: **https://internalportal.nationwideadvance.com/login**

---

## Important notes

- **Do not** expect static `index.html` / `index-aquamark.html` to be served anymore — production is the **Next.js** app in `frontend/`.
- **Data** persists in `data/store.json` and `data/processed/` (gitignored). Ensure `sawaiz` owns `data/` and `logs/` after deploys run as another user.
- **PDF uploads:** nginx `client_max_body_size` is **50m** for Aquamark.
- **Branch:** repo default is `master` (not `main`). Deploy script defaults to `master`.
- **Frontend env:** production uses `NEXT_PUBLIC_API_URL=""` so the browser calls same-origin `/api/*` through nginx.
- **Backend CORS** includes `https://internalportal.nationwideadvance.com` for direct API access if needed.

---

## Key files

| File | Purpose |
|------|---------|
| `ecosystem.config.js` | pm2 app definitions |
| `deploy/update.sh` | Full deploy script |
| `deploy/nginx-watermark.conf` | nginx site config (version-controlled copy) |
| `backend/requirements.txt` | Python dependencies |
| `frontend/package.json` | Node build (`npm run build` / `npm run start`) |

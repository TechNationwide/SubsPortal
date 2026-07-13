#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/vaTeam-WebPage}"
BRANCH="master"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch=*) BRANCH="${1#*=}" ;;
    --branch) BRANCH="${2:-master}"; shift ;;
  esac
  shift
done

cd "$REPO_DIR"
git remote set-url origin git@github-vateam:arslan90ahmad/vaTeam-WebPage.git
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

mkdir -p logs data/processed
if [[ "$(id -un)" != "sawaiz" ]] && command -v sudo >/dev/null 2>&1; then
  sudo chown -R sawaiz:sawaiz logs data backend/.venv 2>/dev/null || true
fi

if [[ ! -d backend/.venv ]]; then
  python3 -m venv backend/.venv
fi
backend/.venv/bin/pip install -q -r backend/requirements.txt

cd frontend
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
NEXT_PUBLIC_API_URL="" npm run build
cd "$REPO_DIR"

if command -v pm2 >/dev/null 2>&1; then
  if [[ "$(id -un)" == "sawaiz" ]]; then
    pm2 startOrReload ecosystem.config.js
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u sawaiz bash -c "cd '$REPO_DIR' && pm2 startOrReload ecosystem.config.js"
  fi
else
  echo "pm2 not found; skipping process reload"
fi

if [[ -f deploy/nginx-watermark.conf ]] && command -v nginx >/dev/null 2>&1; then
  if [[ -w /etc/nginx/sites-available/watermark ]] || [[ -w /etc/nginx/sites-available ]]; then
    cp deploy/nginx-watermark.conf /etc/nginx/sites-available/watermark
    nginx -t && systemctl reload nginx
  elif command -v sudo >/dev/null 2>&1; then
    sudo cp deploy/nginx-watermark.conf /etc/nginx/sites-available/watermark
    sudo nginx -t && sudo systemctl reload nginx
  fi
fi

echo "Deployed $(git rev-parse --short HEAD) on branch $BRANCH"

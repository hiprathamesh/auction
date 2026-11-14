#!/usr/bin/env bash
# Installed on the VM as the forced command for the GitHub Actions deploy key.
set -euo pipefail
umask 077

root=/home/ubuntu/projects/auction-arena
releases="$root/releases"
data="$root/data"
current="$root/current"
node="$root/runtime/bin/node"
commit="${SSH_ORIGINAL_COMMAND:-}"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release identifier.' >&2; exit 1; }
mkdir -p "$releases" "$data/backups"
exec 9>"$releases/.deploy.lock"
flock 9

stage="$(mktemp -d "$releases/.incoming-XXXXXXXX")"
release="$releases/$commit"
previous="$(readlink -f "$current" 2>/dev/null || true)"
switched=0
backup_dir=""
cleanup() {
  local code=$?
  trap - EXIT
  if (( code != 0 && switched == 1 )); then
    echo 'Release failed; restoring the previous version.' >&2
    sudo -n systemctl stop auction-arena.service || true
    if [[ -n "$backup_dir" ]]; then
      for name in seasons identities; do
        if [[ -f "$backup_dir/$name.sqlite" ]]; then
          cp "$backup_dir/$name.sqlite" "$data/$name.sqlite"
          rm -f "$data/$name.sqlite-wal" "$data/$name.sqlite-shm"
        fi
      done
    fi
    if [[ -n "$previous" ]]; then
      ln -sfn "$previous" "$current.next"
      mv -Tf "$current.next" "$current"
      sudo -n systemctl start auction-arena.service || true
    fi
  fi
  rm -rf -- "$stage"
  exit "$code"
}
trap cleanup EXIT

cat >"$stage/release.tar.gz"
mkdir "$stage/files"
tar -xzf "$stage/release.tar.gz" -C "$stage/files"
test -f "$stage/files/dist/index.html"
test -f "$stage/files/server/index.js"
test -d "$stage/files/node_modules/express"
"$node" --check "$stage/files/server/index.js"

backup_dir="$data/backups/release-$commit-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$backup_dir"
for name in seasons identities; do
  if [[ -f "$data/$name.sqlite" ]]; then
    "$node" -e 'const {DatabaseSync,backup}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);backup(db,process.argv[2]).then(()=>db.close()).catch(e=>{console.error(e);process.exitCode=1})' \
      "$data/$name.sqlite" "$backup_dir/$name.sqlite"
  fi
done

if [[ ! -d "$release" ]]; then mv "$stage/files" "$release"; fi
ln -sfn "$release" "$current.next"
mv -Tf "$current.next" "$current"
switched=1
sudo -n systemctl restart auction-arena.service
ready=0
for _ in {1..20}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:4173/api/health >/dev/null; then ready=1; break; fi
  sleep 1
done
(( ready == 1 )) || { echo 'New release did not become healthy.' >&2; exit 1; }
SEASONS_DB_PATH="$data/seasons.sqlite" "$node" -e 'const {createSeasonStore}=require(process.argv[1]);const store=createSeasonStore(process.env.SEASONS_DB_PATH);store.list();store.close()' \
  "$release/server/seasons.js"
echo "Deployed $commit"

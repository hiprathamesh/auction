# IPL Auction Arena

A self-hosted multiplayer IPL auction and T20 league game. One person runs the Node.js server and friends join from their browsers using a room code or invite link. The server controls bids, squads, timers, match results, and tournament progression.

## Requirements

- Node.js 22.13 or newer; Node.js 24 LTS is recommended.
- npm.
- Python 3 for regenerating the player database and running the full test suite.
- A stable host connection. Friends need a browser and access to the host's local network or HTTPS tunnel.

## Run the production build

From the project directory:

```powershell
npm ci
npm run build
npm start
```

Open `http://localhost:4173`. Create a room, choose a franchise, and share the invite link or five-character room code. The host is a player and must also mark themselves ready.

The server listens on `0.0.0.0:4173` by default. For a Cloudflare Tunnel, point the tunnel at `http://localhost:4173` and share your HTTPS subdomain. Your existing tunnel does not need to change. You may set `PORT` and `HOST` before starting the server; for example, `HOST=127.0.0.1` restricts the listener to the host machine while still allowing a local tunnel.

The room code controls entry to the game; anyone with the code can try to join. Seat and host recovery credentials are separate private secrets. Socket origin restrictions can be enabled with `ALLOWED_ORIGINS`, a comma-separated list of full origins such as `https://your-game.example.com,http://localhost:5173`. If this variable is not set, origins are unrestricted to keep local and tunnel setups simple. Apply any Cloudflare access restrictions separately if desired.

## Reconnect, host recovery, and saved rooms

Each seat has a private reconnect credential stored in the player's browser. Refreshing or reconnecting restores the seat while the room exists. Opening the same seat in another tab replaces the older connection. An invite link and public user ID do not grant control of another seat.

The host can open **Host recovery and transfer** in the game, save the private recovery code, generate a new code, or transfer host control to a connected player. Anyone who has both the room code and recovery code can reclaim the host seat, so keep the recovery code private. After recovery or transfer, the old recovery code is invalidated.

Rooms are held in memory by default. A server restart therefore ends existing games unless optional checkpoints are enabled. In PowerShell:

```powershell
$env:ROOM_CHECKPOINTS = '1'
npm start
```

Checkpoints are written locally to `.local/rooms/`, which is ignored by Git. Set `ROOM_DATA_DIR` to use another directory. Checkpoints contain game state and credential verifiers, so keep that directory private. When restored, auctions and active tournament simulations are paused for the host to resume. A restored live match may replay some animation from the most recent checkpoint; completed results are not counted twice. Checkpoint write failures are logged, and local checkpointing cannot guarantee recovery from every disk or power failure.

Completely disconnected rooms expire after 24 hours by default. Set `ROOM_IDLE_HOURS` to a value from 1 to 168 to change the grace period. `MAX_ROOMS` controls the room limit (default 100, maximum 1000). Expiring a room also removes its checkpoint.

The first restart after upgrading from the previous in-memory version ends any currently active game. Start the upgraded server between sessions; old browser sessions do not contain the new private reconnect credentials and will need to join a new room.

## Identity, Hub, and recorded seasons

The **Identity** tab lets a person register or return with a unique ID (4–32 lowercase letters and digits, starting with a letter) and a four-digit PIN. A persistent, HttpOnly browser cookie keeps them signed in for 30 days. The PIN is stored as a salted scrypt hash, and repeated wrong attempts lock the ID for 15 minutes. A four-digit PIN is convenient for friends but has limited entropy; do not reuse a sensitive PIN. People can still play anonymously. Display names remain flexible from room to room, while the ID links the same person across seasons.

An identified host can enable **Record this season** in the lobby settings. When the season completes, the server saves it automatically; test seasons with the toggle off remain temporary. Identified participants find their own seasons at `/s`, and the host who recorded a season can delete it from its detail page. Anonymous participants stay in the scorecards under their display names, without a profile link. The Hub also links to people previously played with and to player profiles. `/p` lists all players; `/p/<player-id>` aggregates their performance across **all** recorded seasons; `/u/<user-id>` shows a registered manager's linked seasons and squads. Signed-in users can open profiles and season details by direct URL, even for seasons outside their Hub. The season page at `/s/<number>` includes XIs, standings, scorecards, auction results, and season statistics. Batting averages count outs in regular match innings; super-over numbers are excluded.

The archive and identities live on the server in separate SQLite databases: `.local/seasons.sqlite` and `.local/identities.sqlite` by default. Both persist across restarts and are ignored by Git. `SEASONS_DB_PATH` sets the season database path; the identity database lives beside it. Room checkpoints can be stored separately with `ROOM_DATA_DIR`. Back up both SQLite databases using a consistent online backup or while the service is stopped. The VM release process makes a backup before each code deployment, but independent off-VM backups are still advisable.

Older season snapshots have display names but no verified identity IDs. After a person registers, the server owner can link an exact historical display name with `node scripts/link_season_identity.js <season-id> <display-name> <registered-id>` while using the same `SEASONS_DB_PATH` as the running server. Do this only with the person's consent or a reliable match; the command updates both the snapshot and indexed statistics. `scripts/season_portability.js` exports or imports one season without copying a live database. The legacy server owner key is still accepted by the deletion API for server administration, but ordinary hosts delete their newly recorded seasons through their own signed-in session.

## Oracle VM deployment

The VM uses `ops/auction-arena.service` with its data under `/home/ubuntu/auction-data` and releases under `/home/ubuntu/auction-releases`. The active release is `/home/ubuntu/auction-current`. Cloudflare Tunnel serves `https://auction-vm.nik.am.in` from the loopback listener on port 4173. A successful **Quality checks** workflow on a push to `main` triggers **Deploy to Oracle VM**. GitHub builds the production bundle and dependencies on its runner, then streams the release over SSH. The VM deploy key is restricted to the fixed `ops/receive-release.sh` command. That command backs up the databases, switches releases, restarts the service, and checks health. If a release fails, it restores the previous release and database backups. Persistent archives, identities, owner keys, room checkpoints, and the tunnel token are outside the release directory and are never shipped to GitHub.

GitHub Actions needs repository secrets `VM_DEPLOY_PRIVATE_KEY` and `VM_KNOWN_HOSTS`. The corresponding public key must be installed in the VM's `ubuntu` authorized keys with a forced command pointing to `/home/ubuntu/auction-deploy/receive-release.sh`. The deployment workflow contains the VM IP; update that address if the VM changes. Pushes may briefly restart live rooms; checkpointing is enabled on the VM so the host can resume after a restart.
## Development and checks

Run the API/socket server and Vite separately:

```powershell
# Terminal 1
npm run dev:server

# Terminal 2
npm run dev
```

Open `http://localhost:5173`. For remote play, serve the production build on port 4173 rather than exposing the Vite development server.

```powershell
npm run check
npm run lint
npm run format:check
npm test
npm run build
npm audit
npm run analyze:simulation -- 5000
```

The tests use isolated loopback servers, simulated seasons, and a headless browser. If a local Chromium/Chrome installation is unavailable, install Playwright's browser with `npx playwright install chromium`. The simulation analysis compares identical teams using repeatable seeds and reports pre-super-over ties. GitHub Actions runs the checks on Windows and Linux. The scoped `minimatch` override in `package.json` supplies the patched version to ESLint until its dependency range catches up.

## Game rules

- Up to ten people can manage unique franchises. There are no bot teams.
- The database contains 288 active-pool players and 52 optional legends. Settings include the purse, timer, rating visibility, legend purchase limit, bid multipliers, Right to Match, and trades.
- On an opening bid, the base price counts as the first step: for example, ×2 bids the base plus one increment. After bidding begins, ×2 adds two increments to the current bid. Increments follow the price ladder and may change at its thresholds.
- Squads hold at most 25 players, including at most eight overseas players. A starting XI has at most four overseas players and four legends. Each team chooses five bowlers, a batting order, and tactics.
- Two or three teams play a league-only season; four or more teams also play the four-team IPL-style playoff bracket. Each league pairing meets twice.
- A tied match uses a super over. If that also ties, an attribute-weighted draw picks the winner.
- The simulation is an arcade model using estimated ratings, tactics, and batting positions. The home team bats first; there is no toss or pitch model. Extras are simplified, and the game does not require a specialist wicketkeeper or bowler role in the XI.
- The host can pause or end the auction, resume remaining or unsold lots, and skip match animation without changing the generated result.

## Player data

`data/auction_players_list.txt` defines the active pool and auction-set order. `data/players.json` is the runtime database. Ratings, base prices, roles, nationality flags, and RTM associations are game-balancing estimates, not official valuations or current-form predictions.

Manual changes belong in `data/player-overrides.json`, keyed by player ID. Existing custom ratings, prices, preferred positions, RTM assignments, and portrait metadata were migrated into that file. After updating the source list or overrides, regenerate the runtime database:

```powershell
python scripts/build_player_db.py
```

The generator reports classifications that rely on heuristics and players without RTM assignments. Review newly added players, especially their role and overseas status. Restart the server after changing player data. The portrait fetcher stores attribution and updates the overrides file so downloaded portrait metadata survives regeneration.

## Project layout

```text
server/index.js             HTTP, socket connection, and room sessions
server/handlers/            Auction, trade, lineup, and tournament actions
server/game.js              Room state, auction lifecycle, standings, and playback
server/cricket.js           Seedable ball-by-ball simulation and fixtures
server/checkpoints.js       Optional local room recovery
server/seasons.js           Persistent season snapshots and indexed statistics
server/identity.js          ID, PIN, and browser-session storage
server/playerDatabase.js    Runtime data validation
src/screens/                Lobby, auction, squads, lineup, and simulation screens
src/archive/                Season history and scorecards
src/hub/                    Hub and player/manager profiles
src/components/             Shared interface components
shared/rules.json           Shared franchises, limits, and bid ladder
data/                       Player source, overrides, and runtime database
scripts/                    Database and portrait tools
tests/                      Engine, socket, recovery, browser, and season checks
```

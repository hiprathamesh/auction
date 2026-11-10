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
server/playerDatabase.js    Runtime data validation
src/screens/                Lobby, auction, squads, lineup, and simulation screens
src/components/             Shared interface components
shared/rules.json           Shared franchises, limits, and bid ladder
data/                       Player source, overrides, and runtime database
scripts/                    Database and portrait tools
tests/                      Engine, socket, recovery, browser, and season checks
```

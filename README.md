# IPL Auction Arena

A self-hosted multiplayer IPL auction and T20 league simulator. One person runs the Node.js server; everyone joins the same room from their own browser. Room state and live bidding are synchronized through Socket.IO.

## What's included

- Private room codes, host/player roles, unique franchise selection, ready checks, reconnect support, and mid-auction joining.
- Host-configurable starting purse, bid timer, optional legend pool, and ratings visibility.
- Auction sets and active-player names imported from the supplied `auction_players_list.txt` in the original set order. Players are shuffled only within their set.
- 46 optional IPL legends, all auctioned in Marquee Set 1, with a maximum of four legends per squad.
- A 334-player JSON database (288 active-pool players and 46 optional legends) with role, Indian/overseas flag, set, base price, OVR, batting, bowling, and fielding ratings.
- Live bidding with purse checks, a 25-player squad limit, eight overseas slots per squad, and a 4-over bowling limit in simulation.
- Squad strength summaries using the top 11 by OVR, starting-XI selection, a user-ordered batting lineup, a five-bowler unit, three tactical choices, a 4-overseas-player playing-XI limit, and ready checks.
- Ball-by-ball T20 simulation, wicket/boundary effects, targets, scorecards, NRR/points table, leaderboards, top four playoffs, and a final.
- Responsive dark UI designed for desktop and mobile browsers.

## Requirements

- Node.js 20 or newer (Node 22 recommended).
- npm.
- A stable connection on the host computer. Friends need a browser and the public URL from your tunnel provider.

## Run locally

Open a terminal in this project folder and run:

```bash
npm install
npm run build
npm start
```

Then open **http://localhost:4173**. Create a room, choose your franchise, and share the invite URL or the 5-character room code. The host is also a player and must click **I'm ready** before starting the auction.

To run the Vite development server instead, use two terminals:

```bash
# Terminal 1 — application server and Socket.IO
npm run dev:server

# Terminal 2 — Vite development UI
npm run dev
```

Open **http://localhost:5173** in development mode. For a friend-facing tunnel, use the built application on port **4173**, not the Vite development server.

## Let friends join over the internet

The Node server listens on `0.0.0.0:4173`, so the tunnel should point to that port.

**Cloudflare Tunnel quick URL** (with `cloudflared` installed):

```bash
cloudflared tunnel --url http://localhost:4173
```

**ngrok** (with `ngrok` installed and configured):

```bash
ngrok http 4173
```

**LocalTunnel**:

```bash
npx localtunnel --port 4173
```

Share the generated HTTPS URL plus your room code. The room code may also be placed in the URL as `?room=ABCDE`; a fresh visitor will see the join flow automatically. Keep the terminal/server running for the entire game. If the tunnel URL changes, share the new one.

This is designed as a friends-only game, not a public service. Anyone who receives the tunnel URL and room code can attempt to join while the room is open, so share them only with your group. Room state is held in memory; restarting the server ends the current game.

## Auction and tournament rules

- Franchises are unique within a room; the app supports up to 10 user-controlled teams and does not create bot teams.
- The default purse is ₹120 Cr. The first bid is the base price; later increments scale with the current price.
- If no one bids before the timer ends, the player is marked unsold. The host can end the auction early or resume the remaining/unsold pool from the results screen.
- A team needs at least 11 players to proceed to XI selection. A room needs at least four teams to start the league, because the requested playoff bracket uses the top four.
- Each league pairing is played twice, home and away. The playoff sequence is Qualifier 1 (1st vs 2nd), Eliminator (3rd vs 4th), Qualifier 2, then the final.
- The live match animation advances at roughly one delivery every 95 ms, with a short pause for wickets and an innings break. The host can skip the visual animation if the group wants to move on faster.
- A tied league/playoff match triggers a one-over super over.

## Player data and ratings

`data/auction_players_list.txt` is the supplied source list and `data/players.json` is the app's compact runtime database. To regenerate it after editing the list:

```bash
python scripts/build_player_db.py
```

The player ratings, base prices, and certain role/nationality classifications are **game-balancing estimates** based on the supplied names and commonly associated T20 roles; they are not official IPL metrics, current-form predictions, or verified player valuations. The OVR formula weights the key skill more heavily according to role, so a specialist batter's bowling rating does not drag down their OVR in the same way as a simple three-stat average.

## Project layout

```text
server/index.js       Express + Socket.IO room/event server
server/game.js        Lobby, auction, standings, tournament lifecycle
server/cricket.js     Ball-by-ball T20 engine and fixture generator
src/main.jsx          React interface
src/styles.css        Responsive UI
 data/players.json     Runtime player database
 data/auction_players_list.txt  Supplied auction-set list
scripts/build_player_db.py      Player database generator
```

## Notes

- There is no external database or account system. Players can reconnect to their existing in-memory seat after a refresh as long as the server stays running and their browser retains local storage.
- The app uses the server's process as the authority for bids, timers, match events, and results. Don't run multiple server instances for the same room.
- The active player pool is the uploaded list (including the seven additional marquee players) plus the 46 optional legends. No bot franchises are added automatically.

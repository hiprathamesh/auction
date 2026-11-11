import { useState } from "react";
import {
  date,
  money,
  number,
  playerPath,
  rate,
  seasonCode,
  Empty,
  Ledger,
  Masthead,
  Panel,
  Shell,
  Status,
  Table,
  Tabs,
  useData,
} from "./HubLayout";

const roles = {
  Batter: "Batters",
  Bowler: "Bowlers",
  "All-rounder": "All-rounders",
  Wicketkeeper: "Wicketkeepers",
};
const sorts = {
  runs: "Runs",
  wickets: "Wickets",
  mvpScore: "MVP points",
  seasons: "Seasons",
  name: "Name",
};
const pageSize = 25;

function PlayerName({ player }) {
  return (
    <a className="hub-player-name" href={playerPath(player.id)}>
      {player.photo && (
        <img
          className="hub-thumbnail"
          src={player.photo}
          alt=""
          loading="lazy"
        />
      )}
      <span>
        <strong>{player.name}</strong>
        <small>
          {[player.role, player.legend ? "Legend" : null]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </span>
    </a>
  );
}

export function PlayersIndex() {
  const state = useData("/api/players");
  const [role, setRole] = useState("All players");
  const [sort, setSort] = useState("runs");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  if (!state.data) return <Status state={state} section="players" />;
  const search = query.trim().toLowerCase();
  const players = state.data.players
    .filter(
      (player) =>
        (role === "All players" || roles[player.role] === role) &&
        [
          player.name,
          player.role,
          player.nationality,
          player.legend ? "legend" : "",
        ].some((value) => value?.toLowerCase().includes(search)),
    )
    .sort(
      (a, b) =>
        (sort === "name" ? 0 : b[sort] - a[sort]) ||
        a.name.localeCompare(b.name),
    );
  const start = page * pageSize;
  const visible = players.slice(start, start + pageSize);
  return (
    <Shell section="players">
      <Masthead
        label="AUCTION ARENA"
        title={
          <>
            Player <em>directory</em>
          </>
        }
        subtitle="Career totals across all recorded seasons."
      />
      <Tabs
        label="Filter by player role"
        tabs={["All players", ...Object.values(roles)]}
        active={role}
        onChange={(value) => {
          setRole(value);
          setPage(0);
        }}
      >
        <Panel
          title={role === "All players" ? "Career leaderboard" : role}
          aside={<span>{number(players.length)} PLAYERS</span>}
        >
          <div className="stats-controls hub-filters">
            <label>
              Search players
              <input
                type="search"
                value={query}
                placeholder="Name, role or nationality"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              Sort by
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  setPage(0);
                }}
              >
                {Object.entries(sorts).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {players.length ? (
            <>
              <Table
                label="Player career leaderboard"
                rows={visible}
                columns={[
                  [
                    "Player",
                    (player, index) => (
                      <div className="hub-directory-name">
                        <span className="hub-position">
                          {start + index + 1}
                        </span>
                        <PlayerName player={player} />
                      </div>
                    ),
                  ],
                  ["Seasons", (player) => number(player.seasons)],
                  ["Runs", (player) => number(player.runs)],
                  ["Wickets", (player) => number(player.wickets)],
                  [
                    "MVP points",
                    (player) => number(Math.round(player.mvpScore)),
                  ],
                ]}
              />
              <nav className="hub-pagination" aria-label="Leaderboard pages">
                <button
                  className="hub-link"
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  ← Previous
                </button>
                <span aria-live="polite">
                  {start + 1}–{start + visible.length} of {players.length}
                </span>
                <button
                  className="hub-link"
                  type="button"
                  disabled={start + pageSize >= players.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next →
                </button>
              </nav>
            </>
          ) : (
            <Empty>No players match those filters.</Empty>
          )}
        </Panel>
      </Tabs>
    </Shell>
  );
}

function Portrait({ player }) {
  const credit = player.photoAttribution;
  if (!player.photo) return null;
  return (
    <figure className="hub-portrait">
      <img src={player.photo} alt="" />
      {credit && (
        <figcaption>
          <a href={credit.sourceUrl} target="_blank" rel="noreferrer">
            {credit.author || credit.source}
          </a>
          {" · "}
          <a
            href={credit.licenseUrl || credit.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {credit.license}
          </a>
        </figcaption>
      )}
    </figure>
  );
}

const seasonColumn = [
  "Season",
  (row) => (
    <a className="hub-data-link" href={"/s/" + row.seasonId}>
      {seasonCode(row.seasonId)}
    </a>
  ),
];
const teamColumn = [
  "Franchise",
  (row) => (
    <>
      {row.squadTeamName || row.teamName || "—"}
      {row.squadOwnerId && (
        <small>
          <a href={"/u/" + row.squadOwnerId}>
            {row.squadOwnerName || row.squadOwnerId}
          </a>
        </small>
      )}
    </>
  ),
];

function SeasonTable({ seasons, columns, label }) {
  return seasons.length ? (
    <Table
      label={label}
      rows={seasons}
      rowKey="seasonId"
      columns={[seasonColumn, teamColumn, ...columns]}
    />
  ) : (
    <Empty>No recorded seasons for this player yet.</Empty>
  );
}

function BarValue({ value, max }) {
  return (
    <span className="hub-bar-value">
      <span>{number(value)}</span>
      <span className="hub-track" aria-hidden="true">
        <span style={{ width: (max ? (value / max) * 100 : 0) + "%" }} />
      </span>
    </span>
  );
}

function CareerOverview({ totals, ranks, seasons }) {
  const rankLabel = (key) => (ranks[key] ? "#" + ranks[key] : "—");
  return (
    <div className="hub-stack">
      <div className="archive-overview-grid hub-overview">
        <Panel title="Career scoreboard" kicker="ALL RECORDED SEASONS">
          <div className="hub-scoreboard">
            <div className="hub-score-block">
              <h3>Batting</h3>
              <p className="hub-score">
                <strong>{number(totals.runs)}</strong> runs
              </p>
              <Ledger
                entries={[
                  ["Average", rate(totals.runs, totals.outs, 1, 2)],
                  ["Strike rate", rate(totals.runs, totals.balls, 100)],
                  ["Highest score", totals.innings ? totals.bestScore : "—"],
                ]}
              />
            </div>
            <div className="hub-score-block">
              <h3>Bowling</h3>
              <p className="hub-score">
                <strong>{number(totals.wickets)}</strong> wickets
              </p>
              <Ledger
                entries={[
                  [
                    "Economy",
                    rate(totals.bowlerRuns, totals.bowlerBalls, 6, 2),
                  ],
                  ["Average", rate(totals.bowlerRuns, totals.wickets, 1, 2)],
                  ["Best figures", totals.bestBowling || "—"],
                ]}
              />
            </div>
          </div>
        </Panel>
        <Panel
          title="Career rankings"
          kicker={ranks.of ? number(ranks.of) + " RANKED PLAYERS" : undefined}
        >
          <Ledger
            entries={[
              ["Runs", totals.runs > 0 ? rankLabel("runs") : "—"],
              ["Wickets", totals.wickets > 0 ? rankLabel("wickets") : "—"],
              ["MVP points", rankLabel("mvp")],
            ]}
          />
          <p className="archive-note">
            {number(Math.round(totals.mvpScore))} career MVP points
          </p>
        </Panel>
      </div>
      <Panel title="Season record">
        <SeasonTable
          seasons={seasons}
          label="Player season record"
          columns={[
            ["Finish", (row) => row.finalFinish?.label || "—"],
            ["Matches", (row) => number(row.matches)],
            ["Runs", (row) => number(row.runs)],
            ["Wickets", (row) => number(row.wickets)],
            ["MVP points", (row) => number(Math.round(row.mvpScore))],
          ]}
        />
      </Panel>
    </div>
  );
}

function Batting({ totals, seasons }) {
  const fourRuns = totals.fours * 4;
  const sixRuns = totals.sixes * 6;
  const otherRuns = Math.max(0, totals.runs - fourRuns - sixRuns);
  const best = Math.max(0, ...seasons.map((row) => row.runs));
  return (
    <div className="hub-stack">
      <div className="archive-overview-grid hub-overview">
        <Panel title="Scoring breakdown">
          {totals.runs > 0 && (
            <div className="hub-stacked-bar" aria-hidden="true">
              <span className="bar-orange" style={{ flexGrow: fourRuns }} />
              <span className="bar-purple" style={{ flexGrow: sixRuns }} />
              <span className="bar-muted" style={{ flexGrow: otherRuns }} />
            </div>
          )}
          <Ledger
            entries={[
              [
                "Fours",
                number(totals.fours) + " fours · " + number(fourRuns) + " runs",
                "bar-orange",
              ],
              [
                "Sixes",
                number(totals.sixes) + " sixes · " + number(sixRuns) + " runs",
                "bar-purple",
              ],
              ["Other scoring", number(otherRuns) + " runs", "bar-muted"],
            ]}
          />
        </Panel>
        <Panel title="Milestones">
          <Ledger
            entries={[
              ["Innings", number(totals.innings)],
              ["Balls faced", number(totals.balls)],
              ["50s", number(totals.fifties)],
              ["100s", number(totals.hundreds)],
            ]}
          />
        </Panel>
      </div>
      <Panel title="Batting by season">
        <SeasonTable
          seasons={seasons}
          label="Batting by season"
          columns={[
            ["Innings", (row) => number(row.innings)],
            ["Runs", (row) => <BarValue value={row.runs} max={best} />],
            ["Average", (row) => rate(row.runs, row.outs, 1, 2)],
            ["Strike rate", (row) => rate(row.runs, row.balls, 100)],
            ["Best", (row) => (row.innings ? row.bestScore : "—")],
            ["4s", (row) => number(row.fours)],
            ["6s", (row) => number(row.sixes)],
            ["50s", (row) => number(row.fifties)],
            ["100s", (row) => number(row.hundreds)],
          ]}
        />
      </Panel>
    </div>
  );
}

function overs(balls) {
  return Math.floor(balls / 6) + "." + (balls % 6);
}

function Bowling({ totals, seasons }) {
  const best = Math.max(0, ...seasons.map((row) => row.wickets));
  return (
    <div className="hub-stack">
      <Panel title="Bowling record">
        <div className="hub-score-line">
          <p className="hub-score">
            <strong>{number(totals.wickets)}</strong> wickets
          </p>
          <Ledger
            entries={[
              ["Overs", overs(totals.bowlerBalls)],
              ["Runs conceded", number(totals.bowlerRuns)],
              ["Economy", rate(totals.bowlerRuns, totals.bowlerBalls, 6, 2)],
              ["Best figures", totals.bestBowling || "—"],
            ]}
          />
        </div>
      </Panel>
      <Panel title="Bowling by season">
        <SeasonTable
          seasons={seasons}
          label="Bowling by season"
          columns={[
            ["Innings", (row) => number(row.bowlingInnings)],
            ["Overs", (row) => overs(row.bowlerBalls || 0)],
            ["Runs conceded", (row) => number(row.bowlerRuns)],
            ["Wickets", (row) => <BarValue value={row.wickets} max={best} />],
            ["Economy", (row) => rate(row.bowlerRuns, row.bowlerBalls, 6, 2)],
            ["Best", (row) => row.bestBowling || "—"],
          ]}
        />
      </Panel>
    </div>
  );
}

function Honours({ totals, seasons }) {
  const honours = [
    ["Champion squad", totals.trophies, "champion"],
    ["Orange Cap", totals.orangeCaps, "orangeCap"],
    ["Purple Cap", totals.purpleCaps, "purpleCap"],
    ["Season MVP", totals.mvpAwards, "mvpAward"],
  ];
  return (
    <div className="hub-stack">
      <Panel title="Honours">
        <Table
          label="Career honours"
          rows={honours.map(([id, count, field]) => ({ id, count, field }))}
          columns={[
            ["Honour", (row) => row.id],
            ["Total", (row) => number(row.count)],
            [
              "Seasons",
              (row) =>
                seasons.some((season) => season[row.field]) ? (
                  <span className="hub-inline-links">
                    {seasons
                      .filter((season) => season[row.field])
                      .map((season) => (
                        <a href={"/s/" + season.seasonId} key={season.seasonId}>
                          {seasonCode(season.seasonId)}
                        </a>
                      ))}
                  </span>
                ) : (
                  "—"
                ),
            ],
          ]}
        />
      </Panel>
      <Panel
        title="Auction history"
        aside={<span>{money(totals.averagePrice)} AVG. PRICE</span>}
      >
        <SeasonTable
          seasons={seasons}
          label="Auction history"
          columns={[
            ["Completed", (row) => date(row.completedAt)],
            ["Auction price", (row) => money(row.price)],
          ]}
        />
      </Panel>
    </div>
  );
}

export function PlayerProfile({ id }) {
  const state = useData("/api/players/" + encodeURIComponent(id));
  const [tab, setTab] = useState("Overview");
  if (!state.data) return <Status state={state} section="players" />;
  const { player, totals, ranks, seasons } = state.data;
  return (
    <Shell section="players">
      <div className="archive-breadcrumb">
        <a href="/p">PLAYERS</a>
        <span>/</span>
        <b>{player.name}</b>
      </div>
      <Masthead
        label={
          [player.role, player.nationality, player.legend ? "Legend" : null]
            .filter(Boolean)
            .join(" · ") || "PLAYER PROFILE"
        }
        title={player.name}
        art={<Portrait player={player} />}
      >
        <div className="hub-masthead-meta">
          <span>
            <b>{totals.seasons}</b>{" "}
            {totals.seasons === 1 ? "season" : "seasons"}
          </span>
          <span>
            <b>{totals.matches}</b> {totals.matches === 1 ? "match" : "matches"}
          </span>
        </div>
      </Masthead>
      <Tabs
        label="Player statistics"
        tabs={["Overview", "Batting", "Bowling", "Honours & auction"]}
        active={tab}
        onChange={setTab}
      >
        {tab === "Overview" && (
          <CareerOverview totals={totals} ranks={ranks} seasons={seasons} />
        )}
        {tab === "Batting" && <Batting totals={totals} seasons={seasons} />}
        {tab === "Bowling" && <Bowling totals={totals} seasons={seasons} />}
        {tab === "Honours & auction" && (
          <Honours totals={totals} seasons={seasons} />
        )}
      </Tabs>
    </Shell>
  );
}

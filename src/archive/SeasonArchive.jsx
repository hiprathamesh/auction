import { useEffect, useMemo, useState } from "react";
import { HubHeader } from "../hub/HubLayout";
import {
  formatMetric,
  metrics,
  qualification,
  rankedRows,
} from "../hub/Leaderboards";
import { ScoreProgression } from "./ScoreProgression";
import "./season.css";

const money = (value) =>
  `₹${Number(value || 0)
    .toFixed(2)
    .replace(/\.00$/, "")} Cr`;
const date = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const teamFor = (season, id) => season.teams.find((team) => team.id === id);
const score = (innings) =>
  innings ? `${innings.runs}/${innings.wickets} (${innings.overs})` : "—";
const rate = (runs, balls) => (balls ? ((runs * 100) / balls).toFixed(1) : "—");
const economy = (runs, balls) =>
  balls ? ((runs * 6) / balls).toFixed(2) : "—";
const PlayerLink = ({ player }) =>
  player?.id ? (
    <a href={`/p/${player.id}`}>{player.name}</a>
  ) : (
    player?.name || "—"
  );
const UserLink = ({ team }) =>
  team?.identityId ? (
    <a href={`/u/${team.identityId}`}>{team.name}</a>
  ) : (
    team?.name || "—"
  );

function Crest({ team, large = false }) {
  if (!team) return <span className="season-crest">—</span>;
  return (
    <span
      className={`season-crest ${large ? "large" : ""}`}
      style={{ "--team": team.teamColor }}
    >
      <img
        src={`/logos/${team.teamId.toLowerCase()}.avif`}
        alt=""
        onError={(event) => {
          event.currentTarget.style.display = "none";
          event.currentTarget.nextSibling.style.display = "block";
        }}
      />
      <b style={{ display: "none" }}>{team.teamShort}</b>
    </span>
  );
}

function Header() {
  return <HubHeader section="seasons" />;
}

function ArchiveIndex() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const load = async (before) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/seasons${before ? `?before=${before}` : ""}`,
      );
      if (!response.ok)
        throw new Error("The archive is unavailable right now.");
      const data = await response.json();
      setItems((previous) =>
        before ? [...previous, ...data.seasons] : data.seasons,
      );
      setMore(data.seasons.length === 24);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <Header />
      <main className="archive-wrap archive-index">
        <div className="archive-kicker">
          <span /> THE HISTORY BOOKS
        </div>
        <h1>
          Every season.
          <br />
          <em>Every story.</em>
        </h1>
        <p className="archive-intro">
          The squads, the scorecards, the moments and the champions. Your league
          lives on here.
        </p>
        <div className="archive-index-heading">
          <div>
            <small>THE COLLECTION</small>
            <h2>Past seasons</h2>
          </div>
          <span>RECORDED BY THE HOST</span>
        </div>
        {error && (
          <p role="alert" className="archive-message">
            {error}
          </p>
        )}
        {!loading && !items.length && !error && (
          <div className="archive-empty">
            <span>✳</span>
            <h3>The story starts here.</h3>
            <p>
              When a season ends, the host can record it to add it to the
              archive.
            </p>
            <a href="/">Start a season ↗</a>
          </div>
        )}
        <div className="season-list">
          {items.map((season) => (
            <a
              className="season-list-card"
              href={`/s/${season.id}`}
              key={season.id}
            >
              <span className="season-list-number">
                S{String(season.id).padStart(2, "0")}
              </span>
              <div>
                <small>CHAMPIONS · {date(season.completedAt)}</small>
                <h3>{season.championName}</h3>
                <p>
                  {season.teamCount} teams <i>·</i> {season.matchCount} matches
                </p>
              </div>
              <b>↗</b>
            </a>
          ))}
        </div>
        {loading && <p className="archive-message">Loading seasons…</p>}
        {more && (
          <button
            className="archive-button secondary"
            disabled={loading}
            onClick={() => load(items[items.length - 1].id)}
          >
            Load more seasons ↓
          </button>
        )}
      </main>
    </>
  );
}

function Standings({ season }) {
  return (
    <section className="archive-panel">
      <div className="panel-title">
        <div>
          <small>THE LEAGUE STAGE</small>
          <h2>
            Final standings<span>.</span>
          </h2>
        </div>
        <span>2 POINTS FOR A WIN</span>
      </div>
      <div className="archive-table-scroll">
        <table className="archive-table">
          <thead>
            <tr>
              <th>POS</th>
              <th>TEAM</th>
              <th>PLD</th>
              <th>W</th>
              <th>L</th>
              <th>NRR</th>
              <th>PTS</th>
            </tr>
          </thead>
          <tbody>
            {season.standings.map((row, index) => {
              const team = teamFor(season, row.userId);
              return (
                <tr key={row.userId}>
                  <td>
                    <span
                      className={`archive-position ${index < 4 && season.teams.length >= 4 ? "qualified" : ""}`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </td>
                  <td>
                    <div className="archive-table-team">
                      <Crest team={team} />
                      <div>
                        <strong>{row.teamName}</strong>
                        <small>
                          <UserLink team={team} />
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{row.played}</td>
                  <td>{row.won}</td>
                  <td>{row.lost}</td>
                  <td className={row.nrr >= 0 ? "positive" : "negative"}>
                    {row.nrr > 0 ? "+" : ""}
                    {Number(row.nrr || 0).toFixed(3)}
                  </td>
                  <td>
                    <strong>{row.points}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="archive-note">
        League standings exclude playoff matches.{" "}
        {season.teams.length >= 4
          ? "The top four advanced to the playoffs."
          : "This season concluded with the league table."}
      </p>
    </section>
  );
}

function Squads({ season }) {
  const [selected, setSelected] = useState(
    season.champion?.id || season.teams[0]?.id,
  );
  const team = teamFor(season, selected) || season.teams[0];
  const starters = team.lineup
    .map((id) => team.squad.find((p) => p.id === id))
    .filter(Boolean);
  const substitutes = team.squad.filter((p) => !team.lineup.includes(p.id));
  const row = (player, index, starting) => (
    <div className="archive-player" key={player.id}>
      <span className="archive-player-number">
        {starting ? String(index + 1).padStart(2, "0") : "—"}
      </span>
      {player.photo ? (
        <img src={player.photo} alt="" loading="lazy" />
      ) : (
        <span className="archive-player-avatar">
          {player.name
            .split(" ")
            .map((word) => word[0])
            .slice(0, 2)
            .join("")}
        </span>
      )}
      <div>
        <strong>
          <PlayerLink player={player} />
        </strong>
        <small>
          {player.role}
          {player.overseas ? " · Overseas" : " · Indian"}
          {player.legend ? " · Legend" : ""}
        </small>
      </div>
      <span className="archive-player-badge">
        {team.bowlerIds.includes(player.id)
          ? "BOWLER"
          : starting
            ? "XI"
            : "SQUAD"}
      </span>
      <b>{player.purchasePrice != null ? money(player.purchasePrice) : "—"}</b>
    </div>
  );
  return (
    <section className="archive-panel">
      <div className="panel-title">
        <div>
          <small>THE PEOPLE BEHIND THE TEAMS</small>
          <h2>
            Squads & XIs<span>.</span>
          </h2>
        </div>
        <span>{season.teams.length} FRANCHISES</span>
      </div>
      <div className="archive-team-picker">
        {season.teams.map((entry) => (
          <button
            key={entry.id}
            className={entry.id === team.id ? "active" : ""}
            onClick={() => setSelected(entry.id)}
            aria-pressed={entry.id === team.id}
          >
            <Crest team={entry} />
            <span>{entry.teamShort}</span>
          </button>
        ))}
      </div>
      <div className="archive-team-banner" style={{ "--team": team.teamColor }}>
        <Crest team={team} large />
        <div>
          <small>
            MANAGED BY <UserLink team={team} />
          </small>
          <h3>{team.teamName}</h3>
          <p>
            {team.squad.length} players · {money(team.purse)} remaining
          </p>
        </div>
      </div>
      <div className="archive-columns">
        <div>
          <h3 className="archive-section-label">
            STARTING XI <span>IN BATTING ORDER</span>
          </h3>
          <div className="archive-player-list">
            {starters.map((p, i) => row(p, i, true))}
          </div>
        </div>
        <div>
          <h3 className="archive-section-label">
            THE REST OF THE SQUAD <span>{substitutes.length} PLAYERS</span>
          </h3>
          <div className="archive-player-list">
            {substitutes.length ? (
              substitutes.map((p, i) => row(p, i, false))
            ) : (
              <p className="archive-note">No substitutes.</p>
            )}
          </div>
          <div className="archive-tactics">
            <small>MATCH PLAN</small>
            <p>
              Batting <b>{team.tactics?.batting || "—"}</b>
            </p>
            <p>
              Bowling <b>{team.tactics?.bowling || "—"}</b>
            </p>
            <p>
              Fielding <b>{team.tactics?.fielding || "—"}</b>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function InningsCard({ innings, full }) {
  const batters = full
    ? [...innings.batters]
    : [...innings.batters]
        .filter((b) => b.balls || b.runs || b.out)
        .sort((a, b) => b.runs - a.runs || a.balls - b.balls);
  const bowlers = [...innings.bowlers]
    .filter((b) => b.legalBalls)
    .sort((a, b) => b.wickets - a.wickets || a.runs - b.runs);
  return (
    <div className="innings-card">
      <div className="innings-heading">
        <strong>{innings.battingTeamName}</strong>
        <b>{score(innings)}</b>
      </div>
      <div className="scorecard-columns">
        <div>
          <small>BATTING</small>
          {(full ? batters : batters.slice(0, 4)).map((b) => (
            <div className="scorecard-row" key={b.player.id}>
              <span>
                <PlayerLink player={b.player} />
                {!b.out && (b.balls || b.runs) ? " *" : ""}
                {full && (
                  <small>
                    {b.dismissal ||
                      (b.balls || b.runs ? "not out" : "did not bat")}{" "}
                    · {b.fours} fours · {b.sixes} sixes
                  </small>
                )}
              </span>
              <b>
                {b.runs} <i>({b.balls})</i>
              </b>
            </div>
          ))}
        </div>
        <div>
          <small>BOWLING</small>
          {(full ? bowlers : bowlers.slice(0, 4)).map((b) => (
            <div className="scorecard-row" key={b.player.id}>
              <span>
                <PlayerLink player={b.player} />
                <small>
                  {b.overs} overs
                  {full ? ` · economy ${economy(b.runs, b.legalBalls)}` : ""}
                </small>
              </span>
              <b>
                {b.wickets}/{b.runs}
              </b>
            </div>
          ))}
        </div>
      </div>
      {full && (
        <p className="archive-note">
          Extras:{" "}
          {innings.runs -
            innings.batters.reduce((sum, batter) => sum + batter.runs, 0)}
        </p>
      )}
    </div>
  );
}

function MatchCard({ season, match, index, selected }) {
  const [expanded, setExpanded] = useState(selected);
  const [balls, setBalls] = useState(null);
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const home = teamFor(season, match.homeId),
    away = teamFor(season, match.awayId),
    winner = teamFor(season, match.winnerId);
  const showDeliveries = async (next) => {
    if (view === next) {
      setView(null);
      return;
    }
    setView(next);
    if (balls) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/seasons/${season.id}/matches/${encodeURIComponent(match.id)}/balls`,
      );
      if (!response.ok) throw new Error("Ball-by-ball is unavailable.");
      setBalls(await response.json());
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <article className="archive-match" id={"match-" + match.id}>
      <div className="archive-match-meta">
        <span>
          {match.round ||
            `LEAGUE · MATCH ${String(index + 1).padStart(2, "0")}`}
        </span>
        <span>FULL TIME</span>
      </div>
      <div className="archive-match-teams">
        {[home, away].map((team) => (
          <div key={team?.id}>
            <Crest team={team} />
            <strong>{team?.teamShort || "—"}</strong>
            <b>
              {score(
                match.innings.find((inn) => inn.battingTeamId === team?.id),
              )}
            </b>
          </div>
        ))}
      </div>
      <div className="archive-result">
        {winner
          ? `${winner.teamName} won by ${match.margin}`
          : match.margin || "Match tied"}
      </div>
      <div className="archive-innings">
        {match.innings.map((inn, i) => (
          <InningsCard
            key={`${inn.battingTeamId}-${i}`}
            innings={inn}
            full={expanded}
          />
        ))}
      </div>
      {Boolean(match.superOver?.length) && (
        <div className="archive-super">
          <small>SUPER OVER</small>
          {match.superOver.map((inn, i) => (
            <span key={i}>
              {inn.battingTeamName} {score(inn)}
            </span>
          ))}
        </div>
      )}
      <div className="archive-match-actions">
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? "Show brief scorecard ↑" : "Full scorecard ↓"}
        </button>
        {match.hasBallByBall && (
          <>
            <button
              onClick={() => showDeliveries("balls")}
              disabled={loading}
              aria-expanded={view === "balls"}
            >
              {loading && view === "balls"
                ? "Loading…"
                : view === "balls"
                  ? "Hide ball-by-ball ↑"
                  : "Ball-by-ball ↓"}
            </button>
            <button
              onClick={() => showDeliveries("progression")}
              disabled={loading}
              aria-expanded={view === "progression"}
            >
              {loading && view === "progression"
                ? "Loading…"
                : view === "progression"
                  ? "Hide score progression ↑"
                  : "Score progression ↓"}
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="archive-note">
          {error}
        </p>
      )}
      {balls && view === "progression" && (
        <ScoreProgression
          innings={match.innings}
          deliveries={balls.innings || []}
        />
      )}
      {balls && view === "balls" && (
        <div className="archive-deliveries">
          {[...(balls.innings || []), ...(balls.superOver || [])].map(
            (events, i) => (
              <div key={i}>
                <h4>{i >= 2 ? "SUPER OVER" : `INNINGS ${i + 1}`}</h4>
                {events.map((event, j) => (
                  <p key={event.key || j}>
                    <b>{event.overs}</b>
                    <span>{event.commentary}</span>
                    <strong>{event.outcome}</strong>
                  </p>
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </article>
  );
}

function Fixtures({ season, selectedMatch }) {
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    if (selectedMatch)
      document
        .getElementById("match-" + selectedMatch)
        ?.scrollIntoView({ block: "start" });
  }, [selectedMatch]);
  const matches = season.matches.filter(
    (match) =>
      filter === "all" ||
      (filter === "league" ? match.type === "league" : match.type !== "league"),
  );
  return (
    <section>
      <div className="panel-title">
        <div>
          <small>EVERY MATCH TELLS A STORY</small>
          <h2>
            Fixtures & results<span>.</span>
          </h2>
        </div>
        <span>{season.matches.length} MATCHES</span>
      </div>
      <div className="archive-filters">
        {[
          ["all", "All matches"],
          ["league", "League"],
          ["playoffs", "Playoffs & final"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="archive-matches">
        {matches.map((match) => (
          <MatchCard
            key={match.id}
            season={season}
            match={match}
            index={season.matches.indexOf(match)}
            selected={match.id === selectedMatch}
          />
        ))}
      </div>
      {!matches.length && (
        <p className="archive-note">No matches in this stage.</p>
      )}
    </section>
  );
}

function Statistics({ season }) {
  const [sort, setSort] = useState("runs");
  const [query, setQuery] = useState("");
  const records = useMemo(() => {
    const outs = new Map();
    for (const match of season.matches) {
      for (const innings of match.innings || []) {
        for (const batter of innings.batters || []) {
          if (batter.out)
            outs.set(batter.player.id, (outs.get(batter.player.id) || 0) + 1);
        }
      }
    }
    return season.playerStats.map((row) => ({
      ...row,
      outs: outs.get(row.playerId) || 0,
    }));
  }, [season]);
  const rows = useMemo(
    () =>
      rankedRows(records, sort, "season").filter((row) =>
        `${row.name} ${row.teamName}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [records, sort, query],
  );
  return (
    <section className="archive-panel">
      <div className="panel-title">
        <div>
          <small>THE NUMBERS BEHIND THE SEASON</small>
          <h2>
            Player statistics<span>.</span>
          </h2>
        </div>
        <span>{season.playerStats.length} PLAYERS</span>
      </div>
      <div className="stats-controls">
        <label>
          Search players
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or team"
          />
        </label>
        <label>
          Rank by
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            {Object.entries(metrics)
              .filter(([, metric]) => metric.group !== "Auction")
              .map(([key, metric]) => (
                <option key={key} value={key}>
                  {metric.label}
                </option>
              ))}
            <option value="sixes">Sixes</option>
            <option value="fours">Fours</option>
            <option value="fifties">Fifties</option>
            <option value="hundreds">Hundreds</option>
          </select>
        </label>
      </div>
      {qualification(sort, "season") && (
        <p className="archive-note">{qualification(sort, "season")}</p>
      )}
      <div className="archive-table-scroll">
        <table className="archive-table stats-table">
          <thead>
            <tr>
              <th>#</th>
              <th>PLAYER</th>
              <th>RUNS</th>
              <th>BALLS</th>
              <th>SR</th>
              <th>4s</th>
              <th>6s</th>
              <th>50s</th>
              <th>100s</th>
              <th>WKTS</th>
              <th>ECON</th>
              <th>BEST</th>
              <th>MVP</th>
              {metrics[sort]?.bottom &&
                !["strikeRate", "economy"].includes(sort) && (
                  <th>{metrics[sort].label}</th>
                )}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.playerId}>
                <td>{p.rank}</td>
                <td>
                  <div>
                    <strong>
                      <a href={`/p/${p.playerId}`}>{p.name}</a>
                    </strong>
                    <small>{p.teamName}</small>
                  </div>
                </td>
                <td>{p.runs}</td>
                <td>{p.balls}</td>
                <td>{rate(p.runs, p.balls)}</td>
                <td>{p.fours}</td>
                <td>{p.sixes}</td>
                <td>{p.fifties}</td>
                <td>{p.hundreds}</td>
                <td>{p.wickets}</td>
                <td>{economy(p.bowlerRuns, p.bowlerBalls)}</td>
                <td>{p.bestBowling || "—"}</td>
                <td>{Math.round(p.mvpScore || 0)}</td>
                {metrics[sort]?.bottom &&
                  !["strikeRate", "economy"].includes(sort) && (
                    <td>{formatMetric(sort, p.value)}</td>
                  )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="archive-note">
          No qualifying players match these filters.
        </p>
      )}
    </section>
  );
}

function Auction({ season }) {
  const [query, setQuery] = useState("");
  const [franchise, setFranchise] = useState("");
  const [set, setSet] = useState("");
  const [order, setOrder] = useState("lot");
  const lots = useMemo(() => {
    const { sales, unsold, history } = season.auction;
    const teamByPlayer = new Map(
      season.teams.flatMap((team) =>
        team.squad.map((player) => [player.id, team.teamName]),
      ),
    );
    const salesByLot = new Map(sales.map((sale) => [sale.lotNumber, sale]));
    const unsoldByLot = new Map(
      unsold.map((entry) => [entry.lotNumber, entry]),
    );
    const tradedPlayers = new Set(
      (season.trades || []).flatMap((trade) => [
        trade.fromPlayer,
        trade.toPlayer,
      ]),
    );
    const originalLots = history?.length
      ? history
      : [
          ...sales.map((sale) => ({
            lotNumber: sale.lotNumber,
            playerId: sale.player.id,
            playerName: sale.player.name,
            teamName: tradedPlayers.has(sale.player.name)
              ? null
              : sale.teamName,
            price: sale.price,
            rtm: sale.rtm,
            result: sale.rtm ? "RTM" : "SOLD",
          })),
          ...unsold.map((entry) => ({
            lotNumber: entry.lotNumber,
            playerId: entry.player.id,
            playerName: entry.player.name,
            result: "UNSOLD",
          })),
        ];
    return originalLots.map((lot) => ({
      ...lot,
      buyer: lot.teamName || null,
      finalTeam: teamByPlayer.get(lot.playerId) || null,
      role: salesByLot.get(lot.lotNumber)?.player.role,
      basePrice: unsoldByLot.get(lot.lotNumber)?.basePrice,
    }));
  }, [season]);
  const sets = [...new Set(lots.map((lot) => lot.set).filter(Boolean))];
  const rows = lots
    .filter(
      (lot) =>
        (!franchise ||
          lot.buyer === franchise ||
          lot.finalTeam === franchise) &&
        (!set || lot.set === set) &&
        `${lot.playerName} ${lot.buyer || ""} ${lot.finalTeam || ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      order === "price"
        ? (b.price ?? -1) - (a.price ?? -1) || a.lotNumber - b.lotNumber
        : a.lotNumber - b.lotNumber,
    );
  const paidLots = rows.filter(
    (lot) => lot.price != null && (!franchise || lot.buyer === franchise),
  );
  return (
    <section className="archive-panel">
      <div className="panel-title">
        <div>
          <small>WHERE THE TEAMS WERE BUILT</small>
          <h2>
            Auction ledger<span>.</span>
          </h2>
        </div>
        <span>{rows.length} LOTS</span>
      </div>
      <div className="stats-controls">
        <label>
          Search lots
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Player or team"
          />
        </label>
        <label>
          Franchise{" "}
          <select
            value={franchise}
            onChange={(event) => setFranchise(event.target.value)}
          >
            <option value="">All franchises</option>
            {season.teams.map((team) => (
              <option key={team.id} value={team.teamName}>
                {team.teamName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Set{" "}
          <select value={set} onChange={(event) => setSet(event.target.value)}>
            <option value="">All sets</option>
            {sets.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Sort by{" "}
          <select
            value={order}
            onChange={(event) => setOrder(event.target.value)}
          >
            <option value="lot">Lot order</option>
            <option value="price">Highest price</option>
          </select>
        </label>
      </div>
      {paidLots.length > 0 && (
        <p className="archive-note">
          {paidLots.length} sold lots ·{" "}
          {money(paidLots.reduce((sum, lot) => sum + lot.price, 0))} in recorded
          winning bids
        </p>
      )}
      <div className="archive-table-scroll">
        <table className="archive-table">
          <thead>
            <tr>
              <th>PLAYER</th>
              <th>LOT</th>
              <th>SET</th>
              <th>RESULT</th>
              <th>ORIGINAL BUYER</th>
              <th>FINAL SQUAD</th>
              <th>PRICE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lot) => (
              <tr key={`${lot.lotNumber}-${lot.playerId}`}>
                <td>
                  <strong>
                    <PlayerLink
                      player={{ id: lot.playerId, name: lot.playerName }}
                    />
                  </strong>
                  <small>{lot.role}</small>
                </td>
                <td>{lot.lotNumber}</td>
                <td>{lot.set || "—"}</td>
                <td>{lot.result}</td>
                <td>{lot.buyer || "—"}</td>
                <td>{lot.finalTeam || "—"}</td>
                <td>
                  <strong>{lot.price != null ? money(lot.price) : "—"}</strong>
                  {lot.price == null && lot.basePrice != null && (
                    <small>{money(lot.basePrice)} base</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="archive-note">No lots match these filters.</p>
      )}
      {Boolean(season.trades?.length) && (
        <div className="archive-trades">
          <h3>Trades</h3>
          {season.trades.map((trade) => (
            <p key={trade.id}>
              <b>{trade.fromTeam}</b> {trade.fromPlayer} ↔ {trade.toPlayer}{" "}
              <b>{trade.toTeam}</b>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function DeleteSeason({ season }) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async (event) => {
    event.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/seasons/${season.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not delete this season.");
      window.location.assign("/s");
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };
  return (
    <section className="archive-owner">
      {!open ? (
        <button className="archive-owner-toggle" onClick={() => setOpen(true)}>
          Delete this season
        </button>
      ) : (
        <form className="archive-owner-form" onSubmit={remove}>
          <h2>Delete season {season.id}?</h2>
          <p>
            This permanently removes this season and its scorecards from the
            archive. Other seasons are unaffected.
          </p>
          <label className="archive-owner-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            I understand that season {season.id} will be permanently deleted.
          </label>
          {error && (
            <p role="alert" className="archive-owner-error">
              {error}
            </p>
          )}
          <div>
            <button type="submit" disabled={!confirmed || busy}>
              {busy ? "Deleting…" : "Permanently delete season"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setConfirmed(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function SeasonDetail({ season }) {
  const matchParam = new URLSearchParams(window.location.search).get("match");
  const selectedMatch = season.matches.some((match) => match.id === matchParam)
    ? matchParam
    : null;
  const [tab, setTab] = useState(selectedMatch ? "fixtures" : "overview");
  const [identity, setIdentity] = useState(null);
  useEffect(() => {
    fetch("/api/identity")
      .then((response) => response.json())
      .then((data) => setIdentity(data.id))
      .catch(() => {});
  }, []);
  const champion = season.champion;
  const leaders = [...season.playerStats];
  const top = (key) =>
    [...leaders].sort((a, b) => {
      const difference = (b[key] || 0) - (a[key] || 0);
      if (difference) return difference;
      if (key === "runs") return b.sixes - a.sixes;
      if (key === "wickets")
        return (
          (a.bowlerBalls ? a.bowlerRuns / a.bowlerBalls : 0) -
          (b.bowlerBalls ? b.bowlerRuns / b.bowlerBalls : 0)
        );
      return 0;
    })[0];
  const awards = [
    ["ORANGE CAP", top("runs"), "runs"],
    ["PURPLE CAP", top("wickets"), "wickets"],
    ["SEASON MVP", top("mvpScore"), "pts"],
  ];
  return (
    <>
      <Header />
      <main className="archive-wrap season-detail">
        <div className="archive-breadcrumb">
          <a href="/s">MY HUB</a>
          <span>/</span>
          <b>SEASON {String(season.id).padStart(2, "0")}</b>
        </div>
        <section className="season-hero">
          <div className="season-hero-copy">
            <div className="archive-kicker">
              <span /> THE CHAMPIONS · {date(season.completedAt).toUpperCase()}
            </div>
            <h1>
              {champion?.teamName || "Season champions"}
              <em> take the crown.</em>
            </h1>
            <p>
              Managed by{" "}
              <strong>
                <UserLink team={champion} />
              </strong>{" "}
              <i>✦</i> Season {String(season.id).padStart(2, "0")}
            </p>
            <div className="hero-metrics">
              <div>
                <b>{season.teams.length}</b>
                <small>TEAMS</small>
              </div>
              <div>
                <b>{season.matches.length}</b>
                <small>MATCHES</small>
              </div>
              <div>
                <b>
                  {season.playerStats
                    .reduce((sum, p) => sum + (p.runs || 0), 0)
                    .toLocaleString()}
                </b>
                <small>RUNS</small>
              </div>
              <div>
                <b>
                  {season.playerStats.reduce(
                    (sum, p) => sum + (p.wickets || 0),
                    0,
                  )}
                </b>
                <small>BOWLER WICKETS</small>
              </div>
            </div>
          </div>
          <div className="season-hero-art">
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <span className="hero-season-number">
              {String(season.id).padStart(2, "0")}
            </span>
            <Crest team={champion} large />
            <span className="hero-art-caption">
              CHAMPIONS
              <br />
              <b>{champion?.teamShort}</b>
            </span>
          </div>
        </section>
        <div
          className="archive-tabs"
          role="tablist"
          aria-label="Season sections"
        >
          {[
            ["overview", "Overview"],
            ["table", "Table"],
            ["squads", "Squads"],
            ["fixtures", "Fixtures"],
            ["stats", "Stats"],
            ["auction", "Auction"],
          ].map(([id, label]) => (
            <button
              role="tab"
              aria-selected={tab === id}
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="archive-content">
          {tab === "overview" && (
            <>
              <div className="archive-awards">
                {awards.map(([title, person, metric]) => (
                  <div className="archive-award" key={title}>
                    <small>{title}</small>
                    <strong>
                      {person ? (
                        <a href={`/p/${person.playerId}`}>{person.name}</a>
                      ) : (
                        "—"
                      )}
                    </strong>
                    <span>{person?.teamName || "No record"}</span>
                    <b>
                      {Math.round(
                        person?.[metric === "pts" ? "mvpScore" : metric] || 0,
                      )}{" "}
                      <i>{metric}</i>
                    </b>
                  </div>
                ))}
              </div>
              <div className="archive-overview-grid">
                <Standings season={season} />
                <aside className="archive-sidebar">
                  <div className="archive-panel">
                    <small>SEASON AT A GLANCE</small>
                    <h3>The campaign</h3>
                    <p>
                      <span>Season</span>
                      <b>#{String(season.id).padStart(2, "0")}</b>
                    </p>
                    <p>
                      <span>Completed</span>
                      <b>{date(season.completedAt)}</b>
                    </p>
                    <p>
                      <span>Starting purse</span>
                      <b>{money(season.settings.startingPurse)}</b>
                    </p>
                    <p>
                      <span>Legends</span>
                      <b>
                        {season.settings.includeLegends ? "Included" : "Off"}
                      </b>
                    </p>
                    <p>
                      <span>Trades</span>
                      <b>{season.settings.tradesEnabled ? "On" : "Off"}</b>
                    </p>
                  </div>
                  <button
                    className="archive-button"
                    onClick={() => setTab("fixtures")}
                  >
                    Explore the results <span>↗</span>
                  </button>
                </aside>
              </div>
            </>
          )}
          {tab === "table" && <Standings season={season} />}
          {tab === "squads" && <Squads season={season} />}
          {tab === "fixtures" && (
            <Fixtures season={season} selectedMatch={selectedMatch} />
          )}
          {tab === "stats" && <Statistics season={season} />}
          {tab === "auction" && <Auction season={season} />}
        </div>
        {identity && identity === season.ownerIdentityId && (
          <DeleteSeason season={season} />
        )}
        <footer className="archive-footer">
          <a href="/s">← MY HUB</a>
          <span>AUCTION ARENA · BUILT FOR THE GROUP CHAT</span>
        </footer>
      </main>
    </>
  );
}

export function SeasonArchive({ id }) {
  const [season, setSeason] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(Boolean(id));
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetch(`/api/seasons/${id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? "Identify yourself to open this season."
              : response.status === 404
                ? "This season hasn't been recorded yet."
                : "The season could not be loaded.",
          );
        return response.json();
      })
      .then(setSeason)
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [id]);
  if (!id) return <ArchiveIndex />;
  if (loading || error)
    return (
      <>
        <Header />
        <main className="archive-wrap archive-index">
          <div className="archive-kicker">
            <span /> SEASON {id}
          </div>
          <div className="archive-empty">
            <span>✳</span>
            <h3>{loading ? "Opening the archives…" : "Season not found."}</h3>
            <p>{error}</p>
            <a href={error.includes("Identify") ? "/?identity=1" : "/s"}>
              {error.includes("Identify")
                ? "Identify yourself ↗"
                : "Back to Hub ↗"}
            </a>
          </div>
        </main>
      </>
    );
  return season ? <SeasonDetail season={season} /> : null;
}

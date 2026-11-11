import { useEffect, useMemo, useState } from "react";
import "../archive/season.css";
import "./hub.css";

const date = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const number = (value) => Number(value || 0).toLocaleString();
const money = (value) =>
  value == null ? "—" : `₹${Number(value).toFixed(2).replace(/\.00$/, "")} Cr`;
const metric = (top, bottom, scale = 1, digits = 1) =>
  bottom ? ((top * scale) / bottom).toFixed(digits) : "—";

function Shell({ children }) {
  return (
    <>
      <header className="archive-top hub-top">
        <a className="archive-brand" href="/">
          <span>✦</span> AUCTION <b>ARENA</b>
        </a>
        <nav>
          <a href="/s">My Hub</a>
          <a href="/p">Players</a>
          <a href="/">Play ↗</a>
        </nav>
      </header>
      <main className="archive-wrap hub-wrap">{children}</main>
    </>
  );
}

function useData(url) {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, data: null, error: "" });
    fetch(url, { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          const error = new Error(result.error || "This page is unavailable.");
          error.status = response.status;
          throw error;
        }
        return result;
      })
      .then((data) => setState({ loading: false, data, error: "" }))
      .catch((error) => {
        if (error.name !== "AbortError")
          setState({
            loading: false,
            data: null,
            error: error.message,
            signIn: error.status === 401,
          });
      });
    return () => controller.abort();
  }, [url]);
  return state;
}

function Status({ state }) {
  return (
    <Shell>
      <div className="hub-empty">
        <span>✳</span>
        <h1>
          {state.loading
            ? "Warming up the Hub…"
            : state.signIn
              ? "Make yourself at home."
              : "We couldn't open this page."}
        </h1>
        <p>{state.loading ? "Pulling the stories together." : state.error}</p>
        {!state.loading && (
          <a className="hub-button" href={state.signIn ? "/?identity=1" : "/s"}>
            {state.signIn ? "Identify yourself ↗" : "Back to Hub ↗"}
          </a>
        )}
      </div>
    </Shell>
  );
}

function PlayerCard({ player, index }) {
  return (
    <a className="hub-player-card" href={`/p/${player.id}`}>
      <span className="hub-player-rank">
        {String(index + 1).padStart(2, "0")}
      </span>
      {player.photo ? (
        <img src={player.photo} alt="" loading="lazy" />
      ) : (
        <span className="hub-player-fallback">✦</span>
      )}
      <div>
        <small>{player.role || `${player.seasons} SEASONS`}</small>
        <h3>{player.name}</h3>
        <p>
          {number(player.runs)} runs <i>·</i> {number(player.wickets)} wickets
        </p>
      </div>
      <b>↗</b>
    </a>
  );
}

function SeasonCard({ season }) {
  return (
    <a href={`/s/${season.id}`} className="hub-season-card">
      <span className="hub-season-number">
        S{String(season.id).padStart(2, "0")}
      </span>
      <div>
        <small>
          {date(season.completedAt)} · {season.teamCount} TEAMS ·{" "}
          {season.matchCount || "—"} MATCHES
        </small>
        <h3>{season.championName}</h3>
        <p>
          {season.yourTeam
            ? `Your side: ${season.yourTeam}`
            : "A season in the books"}
          {season.champion ? " · Champions" : ""}
        </p>
      </div>
      <b>↗</b>
    </a>
  );
}

export function HubHome() {
  const state = useData("/api/hub");
  if (!state.data) return <Status state={state} />;
  const { id, seasons, people, leaders } = state.data;
  return (
    <Shell>
      <section className="hub-hero">
        <div className="archive-kicker">
          <span /> YOUR CORNER OF THE ARENA
        </div>
        <h1>
          Welcome back, <em>@{id}.</em>
        </h1>
        <p>Your seasons, your people, and the players who made the memories.</p>
        <div className="hub-hero-stats">
          <div>
            <strong>{seasons.length}</strong>
            <small>RECENT SEASONS</small>
          </div>
          <div>
            <strong>{people.length}</strong>
            <small>FELLOW PLAYERS</small>
          </div>
          <a href={`/u/${id}`}>View your story ↗</a>
        </div>
      </section>
      <div className="hub-section-head">
        <div>
          <small>THE HISTORY BOOKS</small>
          <h2>
            Your seasons<span>.</span>
          </h2>
        </div>
        <a href="/s/all">View all seasons ↗</a>
      </div>
      {seasons.length ? (
        <div className="hub-season-list">
          {seasons.map((season) => (
            <SeasonCard key={season.id} season={season} />
          ))}
        </div>
      ) : (
        <div className="hub-soft-empty">
          No recorded seasons yet. When a signed-in host enables recording,
          everyone identified in that room will find the completed season here.
        </div>
      )}
      <div className="hub-section-head">
        <div>
          <small>THE NUMBERS PEOPLE</small>
          <h2>
            Player spotlight<span>.</span>
          </h2>
        </div>
        <a href="/p">View all players ↗</a>
      </div>
      <div className="hub-player-grid">
        {leaders.slice(0, 4).map((player, index) => (
          <PlayerCard key={player.id} player={player} index={index} />
        ))}
      </div>
      <div className="hub-section-head">
        <div>
          <small>SHARED CAMPAIGNS</small>
          <h2>
            People you've played with<span>.</span>
          </h2>
        </div>
      </div>
      {people.length ? (
        <div className="hub-people-grid">
          {people.map((person) => (
            <a href={`/u/${person.id}`} className="hub-person" key={person.id}>
              <span>✦</span>
              <div>
                <strong>@{person.id}</strong>
                <small>
                  {person.seasons} shared{" "}
                  {person.seasons === 1 ? "season" : "seasons"}
                </small>
              </div>
              <b>↗</b>
            </a>
          ))}
        </div>
      ) : (
        <div className="hub-soft-empty">
          Your teammates and rivals will appear here after a recorded season.
        </div>
      )}
    </Shell>
  );
}

export function HubSeasons() {
  const [before, setBefore] = useState(null);
  const [items, setItems] = useState([]);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/seasons${before ? `?before=${before}` : ""}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          const error = new Error(result.error);
          error.status = response.status;
          throw error;
        }
        return result;
      })
      .then(({ seasons }) => {
        setItems((old) => (before ? [...old, ...seasons] : seasons));
        setState({ loading: false, more: seasons.length === 24 });
      })
      .catch((error) => {
        if (error.name !== "AbortError")
          setState({
            loading: false,
            error: error.message,
            signIn: error.status === 401,
          });
      });
    return () => controller.abort();
  }, [before]);
  if ((state.loading && !items.length) || state.error)
    return <Status state={state} />;
  return (
    <Shell>
      <div className="hub-page-heading">
        <div className="archive-kicker">
          <span /> YOUR PERSONAL ARCHIVE
        </div>
        <h1>
          Every season. <em>Your story.</em>
        </h1>
        <p>Only seasons you joined with your identity appear here.</p>
      </div>
      {items.length ? (
        <div className="hub-season-list">
          {items.map((season) => (
            <SeasonCard season={season} key={season.id} />
          ))}
        </div>
      ) : (
        <div className="hub-soft-empty">No recorded seasons yet.</div>
      )}
      {state.more && (
        <button
          className="hub-button"
          onClick={() => {
            setState({ loading: true });
            setBefore(items.at(-1).id);
          }}
        >
          Load more ↓
        </button>
      )}
    </Shell>
  );
}

export function PlayersIndex() {
  const state = useData("/api/players");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("runs");
  const players = useMemo(
    () =>
      [...(state.data?.players || [])]
        .filter((player) =>
          `${player.name} ${player.role}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort((a, b) => b[sort] - a[sort] || a.name.localeCompare(b.name)),
    [state.data, query, sort],
  );
  if (!state.data) return <Status state={state} />;
  return (
    <Shell>
      <div className="hub-page-heading">
        <div className="archive-kicker">
          <span /> THE PLAYERS
        </div>
        <h1>
          Every name has <em>a story.</em>
        </h1>
        <p>Career totals across every recorded season on this server.</p>
      </div>
      <div className="hub-controls">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players…"
          aria-label="Search players"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Rank players by"
        >
          <option value="runs">Most runs</option>
          <option value="wickets">Most wickets</option>
          <option value="mvpScore">MVP points</option>
          <option value="seasons">Seasons played</option>
        </select>
      </div>
      <div className="hub-player-grid">
        {players.map((player, index) => (
          <PlayerCard player={player} index={index} key={player.id} />
        ))}
      </div>
    </Shell>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="hub-stat">
      <small>{label}</small>
      <strong>{value}</strong>
      {note && <span>{note}</span>}
    </div>
  );
}

export function PlayerProfile({ id }) {
  const state = useData(`/api/players/${encodeURIComponent(id)}`);
  if (!state.data) return <Status state={state} />;
  const { player, seasons, totals, ranks } = state.data;
  return (
    <Shell>
      <div className="hub-breadcrumb">
        <a href="/p">PLAYERS</a>
        <span>/</span>
        <b>{player.name.toUpperCase()}</b>
      </div>
      <section className="hub-profile-hero">
        <div>
          <div className="archive-kicker">
            <span /> {player.role.toUpperCase()} ·{" "}
            {player.nationality.toUpperCase()}
          </div>
          <h1>
            {player.name}
            <em>.</em>
          </h1>
          <p>
            {player.legend ? "IPL legend · " : ""}
            {totals.seasons} recorded{" "}
            {totals.seasons === 1 ? "season" : "seasons"} on the arena.
          </p>
          <div className="hub-ranks">
            <span>
              RUNS <b>#{ranks.runs || "—"}</b>
            </span>
            <span>
              WICKETS <b>#{ranks.wickets || "—"}</b>
            </span>
            <span>
              MVP <b>#{ranks.mvp || "—"}</b>
            </span>
          </div>
        </div>
        {player.photo && (
          <div className="hub-portrait">
            <img src={player.photo} alt={player.name} />
            {player.photoAttribution && (
              <small>
                Photo:{" "}
                <a
                  href={player.photoAttribution.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {player.photoAttribution.author ||
                    player.photoAttribution.source}
                </a>{" "}
                ·{" "}
                <a
                  href={
                    player.photoAttribution.licenseUrl ||
                    player.photoAttribution.sourceUrl
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {player.photoAttribution.license}
                </a>
              </small>
            )}
          </div>
        )}
      </section>
      <div className="hub-section-head">
        <div>
          <small>CAREER SCOREBOARD</small>
          <h2>
            The numbers<span>.</span>
          </h2>
        </div>
        <span>{totals.matches} MATCH APPEARANCES</span>
      </div>
      <div className="hub-stat-grid">
        <Stat
          label="RUNS"
          value={number(totals.runs)}
          note={`${totals.innings} innings`}
        />
        <Stat
          label="BATTING AVERAGE"
          value={metric(totals.runs, totals.outs, 1, 2)}
          note="runs per dismissal"
        />
        <Stat
          label="STRIKE RATE"
          value={metric(totals.runs, totals.balls, 100)}
          note="per 100 balls"
        />
        <Stat
          label="BOUNDARIES"
          value={`${number(totals.fours)} / ${number(totals.sixes)}`}
          note="fours / sixes"
        />
        <Stat
          label="50s / 100s"
          value={`${totals.fifties} / ${totals.hundreds}`}
        />
        <Stat
          label="BEST SCORE"
          value={totals.innings ? totals.bestScore : "—"}
        />
        <Stat label="WICKETS" value={number(totals.wickets)} />
        <Stat label="BEST FIGURES" value={totals.bestBowling || "—"} />
        <Stat
          label="ECONOMY"
          value={metric(totals.bowlerRuns, totals.bowlerBalls, 6, 2)}
          note="runs per over"
        />
        <Stat label="MVP POINTS" value={number(Math.round(totals.mvpScore))} />
      </div>
      <div className="hub-section-head">
        <div>
          <small>THE TROPHY CABINET</small>
          <h2>
            Honours & value<span>.</span>
          </h2>
        </div>
      </div>
      <div className="hub-stat-grid">
        <Stat label="CHAMPION SQUADS" value={totals.trophies} />
        <Stat label="ORANGE CAPS" value={totals.orangeCaps} />
        <Stat label="PURPLE CAPS" value={totals.purpleCaps} />
        <Stat label="SEASON MVPs" value={totals.mvpAwards} />
        <Stat
          label="AVERAGE AUCTION PRICE"
          value={money(totals.averagePrice)}
        />
      </div>
      <div className="hub-section-head">
        <div>
          <small>SEASON BY SEASON</small>
          <h2>
            Career timeline<span>.</span>
          </h2>
        </div>
      </div>
      {seasons.length ? (
        <div className="hub-timeline">
          {seasons.map((row) => (
            <article className="hub-timeline-row" key={row.seasonId}>
              <span>S{String(row.seasonId).padStart(2, "0")}</span>
              <div>
                <small>
                  {date(row.completedAt)} ·{" "}
                  {row.squadTeamName || row.teamName || "Unassigned"}
                </small>
                <strong>
                  <a href={`/s/${row.seasonId}`}>
                    {row.finalFinish?.label || "Season appearance"} ↗
                  </a>
                </strong>
                {row.squadOwnerId && (
                  <small>
                    Managed by{" "}
                    <a href={`/u/${row.squadOwnerId}`}>@{row.squadOwnerId}</a>
                  </small>
                )}
              </div>
              <div className="hub-timeline-numbers">
                <b>{row.runs} runs</b>
                <b>{row.wickets} wickets</b>
                <b>{money(row.price)}</b>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="hub-soft-empty">
          No recorded seasons featuring this player yet.
        </div>
      )}
    </Shell>
  );
}

export function UserProfile({ id }) {
  const state = useData(`/api/users/${encodeURIComponent(id)}`);
  if (!state.data) return <Status state={state} />;
  const { seasons, totals } = state.data;
  return (
    <Shell>
      <div className="hub-breadcrumb">
        <a href="/s">HUB</a>
        <span>/</span>
        <b>@{id}</b>
      </div>
      <section className="hub-profile-hero hub-user-hero">
        <div>
          <div className="archive-kicker">
            <span /> THE MANAGER FILE
          </div>
          <h1>
            @{id}
            <em>.</em>
          </h1>
          <p>
            {seasons.length
              ? `Known in the arena as ${seasons[0].displayName}.`
              : "A new chapter is waiting to begin."}
          </p>
        </div>
        <div className="hub-user-monogram">{id.slice(0, 2).toUpperCase()}</div>
      </section>
      <div className="hub-section-head">
        <div>
          <small>THE RECORD</small>
          <h2>
            Across the seasons<span>.</span>
          </h2>
        </div>
      </div>
      <div className="hub-stat-grid">
        <Stat label="SEASONS" value={totals.seasons} />
        <Stat label="TROPHIES" value={totals.trophies} />
        <Stat label="LEAGUE WINS" value={totals.wins} />
        <Stat label="LEAGUE LOSSES" value={totals.losses} />
        <Stat label="FRANCHISES MANAGED" value={totals.teams} />
        <Stat
          label="WIN RATE"
          value={metric(totals.wins, totals.wins + totals.losses, 100)}
          note="league matches"
        />
      </div>
      <div className="hub-section-head">
        <div>
          <small>THE CAMPAIGNS</small>
          <h2>
            Season diary<span>.</span>
          </h2>
        </div>
      </div>
      {seasons.length ? (
        <div className="hub-timeline">
          {seasons.map((season) => (
            <article className="hub-user-season" key={season.id}>
              <div className="hub-timeline-row">
                <span>S{String(season.id).padStart(2, "0")}</span>
                <div>
                  <small>
                    {date(season.completedAt)} · AS {season.displayName}
                  </small>
                  <strong>
                    <a href={`/s/${season.id}`}>{season.teamName} ↗</a>
                  </strong>
                  <small>
                    {season.finalFinish?.label || "Season appearance"} ·{" "}
                    {season.wins}W {season.losses}L
                  </small>
                </div>
              </div>
              <div className="hub-user-season-foot">
                <span>TOP SCORER · {season.topScorer || "—"}</span>
                <span>TOP WICKET TAKER · {season.topWicketTaker || "—"}</span>
              </div>
              <details>
                <summary>
                  View squad & playing XI · {season.squad.length} players
                </summary>
                <div className="hub-squad-grid">
                  {season.squad.map((player) => (
                    <a href={`/p/${player.id}`} key={player.id}>
                      <b>{player.name}</b>
                      <small>
                        {player.inXi ? "PLAYING XI" : "SQUAD"} ·{" "}
                        {money(player.price)}
                      </small>
                    </a>
                  ))}
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <div className="hub-soft-empty">
          No linked recorded seasons yet. Historical display names can be mapped
          once everyone has chosen an ID.
        </div>
      )}
    </Shell>
  );
}

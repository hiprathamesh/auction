import { useEffect, useState } from "react";
import {
  date,
  number,
  playerPath,
  seasonCode,
  Empty,
  Masthead,
  Panel,
  Shell,
  Status,
  Table,
  Tabs,
  useData,
} from "./HubLayout";

export { PlayerProfile, PlayersIndex } from "./PlayerPages";
export { UserProfile } from "./UserProfile";

function SeasonRows({ seasons }) {
  if (!seasons.length)
    return (
      <Empty>
        No recorded seasons yet. Join a room with recording enabled to add your
        first season.
      </Empty>
    );
  return (
    <ul className="hub-season-rows">
      {seasons.map((season) => (
        <li key={season.id}>
          <a href={"/s/" + season.id}>
            <span className="hub-season-code">{seasonCode(season.id)}</span>
            <span className="hub-season-entry">
              <strong>{season.yourTeam || season.championName}</strong>
              <small>
                {date(season.completedAt)} · {season.teamCount} teams ·{" "}
                {season.matchCount} matches
              </small>
            </span>
            <span className="hub-season-result">
              <strong>
                {season.champion
                  ? "Champion"
                  : season.leagueFinish
                    ? "League #" + season.leagueFinish
                    : "Completed"}
              </strong>
              {!season.champion && <small>Winner: {season.championName}</small>}
            </span>
            <span className="hub-arrow" aria-hidden="true">
              ↗
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function LeaderList({ leaders }) {
  if (!leaders.length || !leaders.some((player) => player.runs))
    return (
      <Empty>Batting leaders will appear after a season is recorded.</Empty>
    );
  const topRuns = Math.max(...leaders.map((player) => player.runs));
  return (
    <ol className="hub-leader-list">
      {leaders
        .filter((player) => player.runs > 0)
        .map((player, index) => (
          <li key={player.id}>
            <a href={playerPath(player.id)}>
              <span className="hub-position">{index + 1}</span>
              <span className="hub-leader-player">
                <strong>{player.name}</strong>
                <span className="hub-track" aria-hidden="true">
                  <span
                    style={{ width: (player.runs / topRuns) * 100 + "%" }}
                  />
                </span>
              </span>
              <span className="hub-leader-value">
                {number(player.runs)} <small>runs</small>
              </span>
            </a>
          </li>
        ))}
    </ol>
  );
}

export function HubHome() {
  const state = useData("/api/hub");
  const [tab, setTab] = useState("Seasons");
  if (!state.data) return <Status state={state} />;
  const { id, seasons, people, leaders } = state.data;
  const playerLink = (
    <a className="hub-link" href="/p">
      Player directory ↗
    </a>
  );
  return (
    <Shell>
      <Masthead
        label="AUCTION ARENA HUB"
        title={
          <>
            Welcome back, <em>{id}</em>
          </>
        }
      >
        <a className="hub-link" href={"/u/" + id}>
          Your manager profile ↗
        </a>
      </Masthead>
      <Tabs
        label="Hub sections"
        tabs={["Seasons", "Player leaders", "Managers"]}
        active={tab}
        onChange={setTab}
      >
        {tab === "Seasons" && (
          <div className="archive-overview-grid hub-overview">
            <Panel
              title="Recent seasons"
              aside={
                <a className="hub-link" href="/s/all">
                  All seasons ↗
                </a>
              }
            >
              <SeasonRows seasons={seasons} />
            </Panel>
            <Panel
              title="Top run scorers"
              kicker="ALL RECORDED SEASONS"
              aside={playerLink}
            >
              <LeaderList leaders={leaders.slice(0, 4)} />
            </Panel>
          </div>
        )}
        {tab === "Player leaders" && (
          <Panel
            title="Career run leaders"
            kicker="ALL RECORDED SEASONS"
            aside={playerLink}
          >
            <LeaderList leaders={leaders} />
          </Panel>
        )}
        {tab === "Managers" && (
          <Panel title="Managers you’ve played with">
            {people.length ? (
              <Table
                label="Managers you have played with"
                rows={people}
                columns={[
                  [
                    "Manager",
                    (person) => (
                      <a className="hub-data-link" href={"/u/" + person.id}>
                        {person.displayName || person.id}
                      </a>
                    ),
                  ],
                  ["Identity", (person) => person.id],
                  ["Shared seasons", (person) => number(person.seasons)],
                ]}
              />
            ) : (
              <Empty>
                Managers who join a recorded season with you will appear here.
              </Empty>
            )}
          </Panel>
        )}
      </Tabs>
    </Shell>
  );
}

export function HubSeasons() {
  const [before, setBefore] = useState(null);
  const [retry, setRetry] = useState(0);
  const [items, setItems] = useState([]);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/seasons" + (before ? "?before=" + before : ""), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          setState({
            error: result.error || "Could not load seasons.",
            signIn: response.status === 401,
          });
          return;
        }
        const { seasons } = result;
        setItems((old) => (before ? [...old, ...seasons] : seasons));
        setState({ more: seasons.length === 24 });
      })
      .catch((error) => {
        if (error.name !== "AbortError")
          setState({ error: "Could not load seasons." });
      });
    return () => controller.abort();
  }, [before, retry]);
  if (!items.length && (state.loading || state.error))
    return <Status state={state} />;
  return (
    <Shell>
      <div className="archive-breadcrumb">
        <a href="/s">HUB</a>
        <span>/</span>
        <b>SEASONS</b>
      </div>
      <Masthead label="PERSONAL ARCHIVE" title="Your seasons" />
      <div className="hub-content">
        <Panel title="Season archive">
          <SeasonRows seasons={items} />
          {state.error && (
            <p className="archive-note" role="alert">
              {state.error}
            </p>
          )}
          {(state.more || state.loading || state.error) && (
            <button
              type="button"
              className="hub-link hub-load-more"
              disabled={state.loading}
              onClick={() => {
                setState({ loading: true });
                if (state.error) setRetry((value) => value + 1);
                else setBefore(items.at(-1).id);
              }}
            >
              {state.loading
                ? "Loading…"
                : state.error
                  ? "Try again"
                  : "Load more seasons ↓"}
            </button>
          )}
        </Panel>
      </div>
    </Shell>
  );
}

import { useState } from "react";
import { TeamLogo } from "../components/Brand";
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

function Franchise({ season }) {
  return (
    <span className="hub-franchise">
      <TeamLogo
        teamKey={season.teamId}
        short={season.teamId}
        className="hub-team-logo"
        title={season.teamName}
      />
      <strong>{season.teamName}</strong>
    </span>
  );
}

function ManagerOverview({ seasons, totals }) {
  const record = totals.wins + totals.losses;
  const franchises = new Map();
  for (const season of seasons) {
    const franchise = franchises.get(season.teamId) || {
      ...season,
      seasons: 0,
      trophies: 0,
      wins: 0,
      losses: 0,
    };
    franchise.seasons++;
    franchise.trophies += Number(season.champion);
    franchise.wins += season.wins;
    franchise.losses += season.losses;
    franchises.set(season.teamId, franchise);
  }
  return (
    <div className="hub-stack">
      <div className="archive-overview-grid hub-overview">
        <Panel title="League record">
          <div className="hub-win-record">
            <span>
              <b>{totals.wins}</b> wins
            </span>
            <span>
              <b>{totals.losses}</b> losses
            </span>
          </div>
          {record > 0 && (
            <div className="hub-stacked-bar" aria-hidden="true">
              <span className="bar-wins" style={{ flexGrow: totals.wins }} />
              <span
                className="bar-losses"
                style={{ flexGrow: totals.losses }}
              />
            </div>
          )}
          <Ledger
            entries={[
              ["Decided league matches", number(record)],
              ["Win rate", record ? rate(totals.wins, record, 100) + "%" : "—"],
            ]}
          />
        </Panel>
        <Panel title="Manager record">
          <Ledger
            entries={[
              ["Seasons", totals.seasons],
              ["Titles", totals.trophies],
              ["Franchises managed", totals.teams],
            ]}
          />
        </Panel>
      </div>
      <Panel title="Franchise history">
        {franchises.size ? (
          <Table
            label="Franchise history"
            rowKey="teamId"
            rows={[...franchises.values()]}
            columns={[
              ["Franchise", (season) => <Franchise season={season} />],
              ["Seasons", (season) => season.seasons],
              ["Titles", (season) => season.trophies],
              ["Wins", (season) => season.wins],
              ["Losses", (season) => season.losses],
            ]}
          />
        ) : (
          <Empty>No linked seasons yet.</Empty>
        )}
      </Panel>
    </div>
  );
}

export function UserProfile({ id }) {
  const state = useData("/api/users/" + encodeURIComponent(id));
  const [tab, setTab] = useState("Overview");
  const [selection, setSelection] = useState(null);
  if (!state.data) return <Status state={state} />;
  const { seasons, totals } = state.data;
  const latest = seasons[0];
  const squad = seasons.find((season) => season.id === selection) || latest;
  return (
    <Shell>
      <div className="archive-breadcrumb">
        <a href="/s">HUB</a>
        <span>/</span>
        <b>{id}</b>
      </div>
      <Masthead
        label="MANAGER PROFILE"
        title={latest?.displayName || id}
        subtitle={latest?.displayName && latest.displayName !== id ? id : null}
        art={
          latest && (
            <div className="hub-manager-crest">
              <TeamLogo
                teamKey={latest.teamId}
                short={latest.teamId}
                className="hub-team-logo"
                title={latest.teamName}
              />
            </div>
          )
        }
      >
        {latest && (
          <div className="hub-masthead-meta">
            <span>
              Latest franchise <b>{latest.teamName}</b>
            </span>
          </div>
        )}
      </Masthead>
      <Tabs
        label="Manager profile sections"
        tabs={["Overview", "Seasons", "Squads"]}
        active={tab}
        onChange={setTab}
      >
        {tab === "Overview" && (
          <ManagerOverview seasons={seasons} totals={totals} />
        )}
        {tab === "Seasons" && (
          <Panel title="Season results">
            {seasons.length ? (
              <Table
                label="Manager season results"
                rows={seasons}
                columns={[
                  [
                    "Season",
                    (season) => (
                      <>
                        <a className="hub-data-link" href={"/s/" + season.id}>
                          {seasonCode(season.id)}
                        </a>
                        <small>{date(season.completedAt)}</small>
                      </>
                    ),
                  ],
                  ["Franchise", (season) => <Franchise season={season} />],
                  ["Finish", (season) => season.finalFinish?.label || "—"],
                  ["League W–L", (season) => season.wins + "–" + season.losses],
                  [
                    "Squad",
                    (season) => (
                      <button
                        className="hub-link"
                        type="button"
                        onClick={() => {
                          setSelection(season.id);
                          setTab("Squads");
                        }}
                      >
                        View squad →
                      </button>
                    ),
                  ],
                ]}
              />
            ) : (
              <Empty>No linked seasons yet.</Empty>
            )}
          </Panel>
        )}
        {tab === "Squads" && (
          <Panel title="Squad & playing XI">
            {squad ? (
              <>
                <div className="stats-controls hub-filters">
                  <label>
                    Season
                    <select
                      value={squad.id}
                      onChange={(event) =>
                        setSelection(Number(event.target.value))
                      }
                    >
                      {seasons.map((season) => (
                        <option key={season.id} value={season.id}>
                          {seasonCode(season.id)} · {season.teamName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <a className="hub-link" href={"/s/" + squad.id}>
                    Season scorecards ↗
                  </a>
                </div>
                <div className="hub-squad-summary">
                  <Franchise season={squad} />
                  <span>
                    Top scorer <b>{squad.topScorer || "—"}</b>
                  </span>
                  <span>
                    Top wicket taker <b>{squad.topWicketTaker || "—"}</b>
                  </span>
                </div>
                {squad.squad.length ? (
                  <Table
                    label="Squad and playing XI"
                    rows={[...squad.squad].sort(
                      (a, b) => Number(b.inXi) - Number(a.inXi),
                    )}
                    columns={[
                      [
                        "Player",
                        (player) => (
                          <a
                            className="hub-data-link"
                            href={playerPath(player.id)}
                          >
                            {player.name}
                          </a>
                        ),
                      ],
                      [
                        "Selection",
                        (player) =>
                          player.inXi ? <strong>Playing XI</strong> : "Squad",
                      ],
                      ["Price", (player) => money(player.price)],
                    ]}
                  />
                ) : (
                  <Empty>No squad was recorded for this season.</Empty>
                )}
              </>
            ) : (
              <Empty>No linked seasons yet.</Empty>
            )}
          </Panel>
        )}
      </Tabs>
    </Shell>
  );
}

import React from "react";
import { getTeam } from "../lib/format";
import { TeamLogo } from "./Brand";

export function LeaderCard({ title, accent, value, metric, onClick }) {
  return (
    <button className={`leader-card ${accent}`} onClick={onClick}>
      <div className="leader-card-top">
        <span>{title}</span>
        <span className="leader-arrow">↗</span>
      </div>
      {value ? (
        <>
          <div className="leader-name">{value.name}</div>
          <div className="leader-team">
            {value.teamName || value.teamId || "Tournament leader"}
          </div>
          <div className="leader-bottom">
            <strong>
              {metric === "mvpScore"
                ? Math.round(value[metric] || 0)
                : value[metric] || 0}
            </strong>
            <span>
              {metric === "runs"
                ? "RUNS"
                : metric === "wickets"
                  ? "WICKETS"
                  : "MVP PTS"}
            </span>
          </div>
        </>
      ) : (
        <div className="leader-empty">Yet to be decided</div>
      )}
    </button>
  );
}

export function LeagueTable({ room }) {
  const standings = room.standings || [];
  return (
    <div className="league-table-wrap">
      <table className="league-table">
        <thead>
          <tr>
            <th>#</th>
            <th>TEAM</th>
            <th>PLD</th>
            <th>W</th>
            <th>L</th>
            <th>NRR</th>
            <th>PTS</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((t) => (
            <tr key={t.userId}>
              <td>
                <span
                  className={`position ${t.position <= 4 ? "qualify" : ""}`}
                >
                  {t.position}
                </span>
              </td>
              <td>
                <div className="table-team">
                  <TeamLogo
                    teamKey={t.teamShort}
                    short={t.teamShort}
                    className="table-team-logo"
                    title={t.teamName}
                  />
                  <div>
                    <strong>{t.teamName}</strong>
                    <small>{t.userName}</small>
                  </div>
                </div>
              </td>
              <td>{t.played}</td>
              <td>{t.won}</td>
              <td>{t.lost}</td>
              <td
                className={
                  t.nrr > 0 ? "positive-nrr" : t.nrr < 0 ? "negative-nrr" : ""
                }
              >
                {t.nrr > 0 ? "+" : ""}
                {Number(t.nrr || 0).toFixed(3)}
              </td>
              <td>
                <strong className="points-cell">{t.points}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!standings.length && (
        <div className="table-empty">
          The points table will update after the first match.
        </div>
      )}
    </div>
  );
}

export function FinalistsScreen({ room, isHost, onStart }) {
  const finalists = (room.playoff?.finalists || [])
    .map((id) => getTeam(room, id))
    .filter(Boolean);
  return (
    <section className="finalists-screen glass-card">
      <div className="eyebrow">
        <span className="eyebrow-line" /> THE FINAL IS SET
      </div>
      <div className="finalists-trophy">♜</div>
      <h2>
        The last two <em>standing.</em>
      </h2>
      <p>Qualifier 1 and Qualifier 2 have delivered your finalists.</p>
      <div className="finalists-versus">
        {finalists.map((u, i) => (
          <React.Fragment key={u.id}>
            {i === 1 && <div className="finalist-vs">VS</div>}
            <div
              className="finalist-team"
              style={{ "--team-color": u.teamColor }}
            >
              <TeamLogo
                teamKey={u.teamShort}
                short={u.teamShort}
                className="finalist-crest"
                title={u.teamName}
              />
              <strong>{u.teamName}</strong>
              <span>Managed by {u.name}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
      {isHost ? (
        <button className="button primary final-start-button" onClick={onStart}>
          Start the final <span>↗</span>
        </button>
      ) : (
        <div className="awaiting-host large">
          The host will start the final.
        </div>
      )}
    </section>
  );
}

export function ChampionScreen({ room, openStats }) {
  const champion = getTeam(room, room.championId);
  const leaders = room.playerLeaders || {};
  return (
    <div className="champion-page">
      <section className="champion-hero">
        <div className="champion-sparks">
          ✦ <span>✧</span> ✦
        </div>
        <div className="eyebrow">
          <span className="eyebrow-line" /> THE SEASON IS COMPLETE
        </div>
        <div className="champion-cup">♜</div>
        <div className="champion-label">IPL AUCTION ARENA CHAMPIONS</div>
        <h1>
          {champion?.teamName || "Tournament champion"}
          <br />
          <em>take the crown.</em>
        </h1>
        <div className="champion-manager">
          {champion?.teamShort} · Managed by {champion?.name}
        </div>
        <div className="champion-actions">
          {room.archivedSeasonId ? (
            <a
              className="button primary"
              href={`/s/${room.archivedSeasonId}`}
              target="_blank"
              rel="noreferrer"
            >
              View season {room.archivedSeasonId} ↗
            </a>
          ) : room.settings.recordSeason ? (
            <span className="archive-awaiting">
              Recording is pending. The host can retry from host options.
            </span>
          ) : null}
          <button
            className="button primary"
            onClick={() =>
              document
                .getElementById("final-stats")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            View season stats ↓
          </button>
          <button
            className="button secondary"
            onClick={() => openStats("more")}
          >
            Awards & records ↗
          </button>
        </div>
      </section>
      <section className="champion-awards" id="final-stats">
        <div className="award-tile orange">
          <span>ORANGE CAP</span>
          <strong>{leaders.orangeCap?.[0]?.name || "—"}</strong>
          <b>{leaders.orangeCap?.[0]?.runs || 0} runs</b>
        </div>
        <div className="award-tile purple">
          <span>PURPLE CAP</span>
          <strong>{leaders.purpleCap?.[0]?.name || "—"}</strong>
          <b>{leaders.purpleCap?.[0]?.wickets || 0} wickets</b>
        </div>
        <div className="award-tile mvp">
          <span>TOURNAMENT MVP</span>
          <strong>{leaders.mvp?.[0]?.name || "—"}</strong>
          <b>{Math.round(leaders.mvp?.[0]?.mvpScore || 0)} MVP pts</b>
        </div>
      </section>
      <section className="glass-card table-card champion-table">
        <div className="panel-header">
          <div>
            <span className="section-kicker">FINAL STANDINGS</span>
            <h3>The completed league table</h3>
          </div>
          <span className="table-note">
            {room.totalLeagueMatches} LEAGUE MATCHES
          </span>
        </div>
        <LeagueTable room={room} />
      </section>
      <div className="final-review-row">
        <div>
          <span className="section-kicker">FULL TOURNAMENT RECORD</span>
          <h3>Every run, wicket and result.</h3>
          <p>Review leaderboards and player milestones from the season.</p>
        </div>
        <button className="button primary" onClick={() => openStats("more")}>
          Open full stats ↗
        </button>
      </div>
    </div>
  );
}

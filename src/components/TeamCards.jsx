import rules from "../../shared/rules.json";
import { money } from "../lib/format";
import { TeamLogo } from "./Brand";

const DEFAULT_AUCTION_LEGEND_LIMIT = rules.defaultLegendAuctionLimit;

export function TeamRatingsStrip({
  ratings,
  label = "TEAM STRENGTH",
  compact = false,
}) {
  const stats = [
    ["OVR", ratings?.ovr],
    ["BAT", ratings?.batting],
    ["BOWL", ratings?.bowling],
    ["FIELD", ratings?.fielding],
  ];
  return (
    <div className={`team-ratings-strip ${compact ? "compact" : ""}`}>
      <div className="team-ratings-label">{label}</div>
      <div className="team-ratings-values">
        {stats.map(([name, value]) => (
          <div className="team-rating-cell" key={name}>
            <span>{name}</span>
            <strong>{Number.isFinite(value) ? value : "—"}</strong>
          </div>
        ))}
      </div>
      {!ratings && (
        <small className="team-ratings-note">
          Complete at least 11 signings to calculate all four ratings.
        </small>
      )}
    </div>
  );
}

export function SquadCard({
  user,
  showRatings,
  startingPurse,
  legendAuctionLimit = DEFAULT_AUCTION_LEGEND_LIMIT,
  isMe,
  isHost,
  onKick,
}) {
  const grouped = [
    ["BAT", user.squad.filter((p) => p.role === "Batter")],
    ["WK", user.squad.filter((p) => p.role === "Wicketkeeper")],
    ["AR", user.squad.filter((p) => p.role === "All-rounder")],
    ["BOWL", user.squad.filter((p) => p.role === "Bowler")],
  ].filter(([, list]) => list.length);
  return (
    <section
      className={`glass-card squad-card ${isMe ? "my-squad-card" : ""}`}
      style={{ "--team-color": user.teamColor }}
    >
      <div className="squad-card-head">
        <TeamLogo
          teamKey={user.teamShort}
          short={user.teamShort}
          className="team-badge"
          title={user.teamName}
        />
        <div className="squad-card-title">
          <strong>{user.teamName}</strong>
          <span>
            Managed by {user.name}
            {isMe ? " · YOU" : ""}
          </span>
        </div>
        <div className="squad-card-count">
          <strong>{user.squadCount}</strong>
          <span>PLAYERS</span>
        </div>
        {isHost && !isMe && (
          <button
            type="button"
            className="kick-user-button"
            title={`Remove ${user.name}`}
            aria-label={`Remove ${user.name} from room`}
            onClick={() => onKick(user)}
          >
            ×
          </button>
        )}
      </div>
      <div className="squad-card-money">
        <div>
          <span>PURSE LEFT</span>
          <strong>{money(user.purse)}</strong>
        </div>
        <div>
          <span>OVERSEAS</span>
          <strong>{user.overseasCount}/8</strong>
        </div>
        <div>
          <span>LEGENDS</span>
          <strong>
            {user.legendCount || user.squad.filter((p) => p.legend).length}/
            {legendAuctionLimit === "unlimited" ? "∞" : legendAuctionLimit}
          </strong>
        </div>
        <div>
          <span>SPENT</span>
          <strong>{money(startingPurse - user.purse)}</strong>
        </div>
      </div>
      <TeamRatingsStrip
        ratings={user.teamRatings}
        label="TEAM STRENGTH · TOP 11 BY OVR"
        compact
      />
      <div className="squad-roles">
        {grouped.length ? (
          grouped.map(([role, ps]) => (
            <div className="squad-role-group" key={role}>
              <div className="role-group-title">
                <span>{role}</span>
                <i />
                <b>{ps.length}</b>
              </div>
              {ps.map((p) => (
                <div className="squad-player-line" key={p.id}>
                  <span
                    className="squad-country"
                    title={p.overseas ? "Overseas" : "Indian"}
                  >
                    {p.overseas ? "OS" : "IN"}
                  </span>
                  <strong>{p.name}</strong>
                  {showRatings && (
                    <span className="squad-player-ovr">{p.ovr}</span>
                  )}
                  <b>{p.retained ? "Retained" : money(p.purchasePrice)}</b>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="empty-mini">No players in the squad yet.</div>
        )}
      </div>
    </section>
  );
}

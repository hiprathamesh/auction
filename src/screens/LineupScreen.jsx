import { TeamLogo } from "../components/Brand";
import { TeamRatingsStrip } from "../components/TeamCards";

export function LineupScreen(props) {
  const {
    auctionLegendLimit,
    lineupSelection,
    bowlerSelection,
    me,
    MAX_XI_LEGENDS,
    activeFilter,
    setActiveFilter,
    sortPlayer,
    room,
    toggleLineupPlayer,
    roleShort,
    money,
    preferredPositions,
    formatPreferredPositions,
    moveBattingOrder,
    toggleBowler,
    TACTIC_OPTIONS,
    tacticsSelection,
    setTactic,
    emitAction,
    saveLineup,
    isHost,
    meId,
    kickUser,
    allXIsReady,
    hostAction,
  } = props;
  return (
    <main className="wrap page-content lineup-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> PLAYING XI
          </div>
          <h2>
            Build your <em>match plan.</em>
          </h2>
          <p>
            Select 11 players, arrange the batting order, then choose the five
            bowlers who will share the 20 overs. No more than four overseas
            players or four legends in the XI. You can own{" "}
            {Number.isFinite(auctionLegendLimit)
              ? `up to ${auctionLegendLimit}`
              : "any number of"}{" "}
            legends in your squad.
          </p>
        </div>
        <div
          className={`xi-counter ${lineupSelection.length === 11 && bowlerSelection.length === 5 ? "complete" : ""}`}
        >
          <strong>
            {lineupSelection.length}
            <span>/11</span>
          </strong>
          <span>SELECTED</span>
          <small>{bowlerSelection.length}/5 BOWLERS</small>
        </div>
      </div>
      <TeamRatingsStrip
        ratings={me?.teamRatings}
        label="YOUR TEAM STRENGTH · TOP 11 BY OVR"
      />
      <div className="lineup-layout">
        <section className="glass-card lineup-selector">
          <div className="panel-header">
            <div>
              <span className="section-kicker">
                YOUR SQUAD · {me?.squadCount || 0} PLAYERS
              </span>
              <h3>{me?.teamName}</h3>
            </div>
            <div className="lineup-limit-counters">
              <div className="overseas-counter">
                OVERSEAS{" "}
                <b>
                  {me?.squad?.filter(
                    (p) => lineupSelection.includes(p.id) && p.overseas,
                  ).length || 0}
                  /4
                </b>
              </div>
              <div className="overseas-counter">
                LEGENDS{" "}
                <b>
                  {me?.squad?.filter(
                    (p) => lineupSelection.includes(p.id) && p.legend,
                  ).length || 0}
                  /{MAX_XI_LEGENDS}
                </b>
              </div>
            </div>
          </div>
          <div className="filter-tabs">
            {["All", "Batter", "Wicketkeeper", "All-rounder", "Bowler"].map(
              (f) => (
                <button
                  key={f}
                  className={activeFilter === f ? "active" : ""}
                  onClick={() => setActiveFilter(f)}
                >
                  {f === "All"
                    ? "All players"
                    : f === "All-rounder"
                      ? "All-rounders"
                      : f === "Wicketkeeper"
                        ? "Keepers"
                        : `${f}s`}
                </button>
              ),
            )}
          </div>
          <div className="lineup-player-list">
            {[...(me?.squad || [])]
              .filter((p) => activeFilter === "All" || p.role === activeFilter)
              .sort((a, b) => sortPlayer(a, b, room.settings.showRatings))
              .map((p) => {
                const selected = lineupSelection.includes(p.id);
                const xiLegendCount =
                  me?.squad?.filter(
                    (player) =>
                      lineupSelection.includes(player.id) && player.legend,
                  ).length || 0;
                const blockedByLegendLimit =
                  !selected && p.legend && xiLegendCount >= MAX_XI_LEGENDS;
                return (
                  <button
                    key={p.id}
                    className={`lineup-player ${selected ? "picked" : ""}`}
                    disabled={me?.xiReady || blockedByLegendLimit}
                    title={
                      blockedByLegendLimit
                        ? `The playing XI is limited to ${MAX_XI_LEGENDS} legends.`
                        : ""
                    }
                    onClick={() => toggleLineupPlayer(p.id)}
                  >
                    <span className={`pick-box ${selected ? "checked" : ""}`}>
                      {selected ? "✓" : ""}
                    </span>
                    <span className="lineup-role">{roleShort[p.role]}</span>
                    <div className="lineup-player-info">
                      <strong>{p.name}</strong>
                      <span>
                        {p.overseas ? "Overseas" : "Indian"} · {p.set}
                        {p.legend ? " · LEGEND" : ""}
                        {blockedByLegendLimit ? " · XI LIMIT REACHED" : ""}
                      </span>
                    </div>
                    {room.settings.showRatings && (
                      <b className="player-ovr">{p.ovr}</b>
                    )}
                    <span className="lineup-price">
                      {p.retained ? "Retained" : money(p.purchasePrice)}
                    </span>
                  </button>
                );
              })}
          </div>
          <div className="lineup-detail-grid">
            <section className="lineup-detail-panel">
              <div className="lineup-detail-heading">
                <div>
                  <span className="section-kicker">01 · BATTING ORDER</span>
                  <h4>Who bats when?</h4>
                </div>
                <span className="detail-count">
                  {lineupSelection.length}/11
                </span>
              </div>
              <p>
                Use the arrows to set the exact arrival order. Player 1 and 2
                open the innings.
              </p>
              {lineupSelection.length === 0 ? (
                <div className="detail-empty">
                  Select your XI to arrange the batting order.
                </div>
              ) : (
                <ol className="batting-order-list">
                  {lineupSelection.map((id, index) => {
                    const player = me?.squad?.find((p) => p.id === id);
                    if (!player) return null;
                    const prefs = preferredPositions(player);
                    const positionMatches = prefs.includes(index + 1);
                    return (
                      <li
                        key={id}
                        className={`batting-order-row ${positionMatches ? "preferred-slot-row" : ""}`}
                      >
                        <span className="batting-position">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="batting-order-player">
                          <strong>{player.name}</strong>
                          <span>
                            {roleShort[player.role]}
                            {room.settings.showRatings
                              ? ` · BAT ${player.batting}`
                              : ""}
                          </span>
                          {prefs.length > 0 && (
                            <small
                              className={`preferred-position-status ${positionMatches ? "matched" : ""}`}
                            >
                              {positionMatches
                                ? "✓ PREFERRED POSITION · +17% RUN ODDS"
                                : `Preferred: ${formatPreferredPositions(prefs)}`}
                            </small>
                          )}
                        </div>
                        <div className="order-controls">
                          <button
                            type="button"
                            title="Move up in batting order"
                            aria-label={`Move ${player.name} up`}
                            disabled={me?.xiReady || index === 0}
                            onClick={() => moveBattingOrder(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            title="Move down in batting order"
                            aria-label={`Move ${player.name} down`}
                            disabled={
                              me?.xiReady ||
                              index === lineupSelection.length - 1
                            }
                            onClick={() => moveBattingOrder(index, 1)}
                          >
                            ↓
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
            <section className="lineup-detail-panel">
              <div className="lineup-detail-heading">
                <div>
                  <span className="section-kicker">02 · BOWLING UNIT</span>
                  <h4>Choose your five</h4>
                </div>
                <span
                  className={`detail-count ${bowlerSelection.length === 5 ? "complete" : ""}`}
                >
                  {bowlerSelection.length}/5
                </span>
              </div>
              <p>
                The five with the best bowling ratings are preselected. Each can
                bowl up to four overs; change the selection if you prefer.
              </p>
              {lineupSelection.length === 0 ? (
                <div className="detail-empty">
                  Choose your XI first. The best five bowlers will be selected
                  automatically.
                </div>
              ) : (
                <div className="bowler-choice-list">
                  {lineupSelection.map((id, index) => {
                    const player = me?.squad?.find((p) => p.id === id);
                    if (!player) return null;
                    const checked = bowlerSelection.includes(id);
                    return (
                      <label
                        key={id}
                        className={`bowler-choice ${checked ? "selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={
                            me?.xiReady ||
                            (!checked && bowlerSelection.length >= 5)
                          }
                          onChange={() => toggleBowler(id)}
                        />
                        <span className="bowler-choice-info">
                          <strong>{player.name}</strong>
                          <span>
                            {roleShort[player.role]}
                            {room.settings.showRatings
                              ? ` · BOWL ${player.bowling}`
                              : ""}
                          </span>
                        </span>
                        {checked && <b>SELECTED</b>}
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
          <section className="lineup-detail-panel match-tactics-panel">
            <div className="lineup-detail-heading">
              <div>
                <span className="section-kicker">03 · MATCH TACTICS</span>
                <h4>Choose your team style</h4>
              </div>
              <span className="detail-count">SMALL EDGES</span>
            </div>
            <p>
              These settings slightly bias the simulation. Ratings and luck
              still decide most outcomes.
            </p>
            <div className="tactics-grid">
              {Object.entries(TACTIC_OPTIONS).map(([group, config]) => (
                <section className="tactic-group" key={group}>
                  <div className="tactic-group-heading">
                    <span>{config.title}</span>
                    <strong>{config.question}</strong>
                  </div>
                  <div className="tactic-options">
                    {config.options.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        disabled={me?.xiReady}
                        className={`tactic-option ${tacticsSelection[group] === option.id ? "selected" : ""}`}
                        aria-pressed={tacticsSelection[group] === option.id}
                        onClick={() => setTactic(group, option.id)}
                      >
                        <span className="tactic-option-top">
                          <strong>{option.label}</strong>
                          <i>
                            {tacticsSelection[group] === option.id
                              ? "SELECTED"
                              : "SELECT"}
                          </i>
                        </span>
                        <span className="tactic-description">
                          {option.description}
                        </span>
                        <span className="tactic-pro">{option.pro}</span>
                        <span className="tactic-con">{option.con}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
          <div className="lineup-bottom">
            <span>
              {lineupSelection.length === 11 && bowlerSelection.length === 5
                ? "XI, batting order, bowling unit and tactics are ready."
                : `${Math.max(0, 11 - lineupSelection.length)} XI spots · ${Math.max(0, 5 - bowlerSelection.length)} bowling spots remaining.`}
            </span>
            {me?.xiReady ? (
              <button
                className="button secondary"
                onClick={() => emitAction("lineup:ready", false)}
              >
                Edit match plan
              </button>
            ) : (
              <button
                className="button primary"
                disabled={
                  lineupSelection.length !== 11 || bowlerSelection.length !== 5
                }
                onClick={saveLineup}
              >
                Submit match plan →
              </button>
            )}
          </div>
        </section>
        <aside className="lineup-aside">
          <div className="glass-card lineup-status-card">
            <span className="section-kicker">LEAGUE READINESS</span>
            <h3>All teams need to be ready.</h3>
            <p>
              The league starts after each player locks in their XI, batting
              order and five-bowler unit.
            </p>
            {room.users.map((u) => (
              <div className="xi-ready-row" key={u.id}>
                <TeamLogo
                  teamKey={u.teamShort}
                  short={u.teamShort}
                  className="xi-team-crest"
                  title={u.teamName}
                />
                <div>
                  <strong>{u.name}</strong>
                  <span>
                    {u.teamName} · {u.lineup?.length || 0}/11 ·{" "}
                    {u.bowlerIds?.length || 0}/5 bowlers
                    {!u.connected ? " · OFFLINE" : ""}
                  </span>
                </div>
                <b
                  className={
                    u.xiReady &&
                    u.lineup?.length === 11 &&
                    u.bowlerIds?.length === 5
                      ? "ready"
                      : ""
                  }
                >
                  {u.xiReady &&
                  u.lineup?.length === 11 &&
                  u.bowlerIds?.length === 5
                    ? "READY"
                    : "PICKING"}
                </b>
                {isHost && u.id !== meId && (
                  <button
                    type="button"
                    className="kick-user-button"
                    title={`Remove ${u.name}`}
                    aria-label={`Remove ${u.name} from room`}
                    onClick={() => kickUser(u)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {isHost && (
              <button
                className="button primary full-button"
                disabled={!allXIsReady || room.users.length < 2}
                onClick={() => hostAction("host:startLeague")}
              >
                Start league simulation <span>↗</span>
              </button>
            )}
            {!isHost && (
              <div className="awaiting-host">
                {allXIsReady
                  ? "All teams are ready. Waiting for the host."
                  : "Submit your full match plan and wait for other teams."}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

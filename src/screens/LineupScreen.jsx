import { buildBowlingPlan } from "../../shared/bowling-plan.mjs";
import { TeamLogo } from "../components/Brand";
import { TeamRatingsStrip } from "../components/TeamCards";
import { playerStrengths } from "../lib/format";

export function LineupScreen(props) {
  const {
    auctionLegendLimit,
    lineupSelection,
    bowlerSelection,
    bowlingPlan,
    setBowlingPlan,
    superOverPlan,
    setSuperOverPlan,
    hasBowlingUnit,
    maxBowlingOptions,
    editingPlan,
    closeTeamPlan,
    suggestPlan,
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
  const locked = me?.xiReady && !editingPlan;
  const selected = lineupSelection
    .map((id) => me?.squad.find((p) => p.id === id))
    .filter(Boolean);
  const unit = bowlerSelection
    .map((id) => selected.find((p) => p.id === id))
    .filter(Boolean);
  const allocation = hasBowlingUnit(bowlerSelection)
    ? buildBowlingPlan(unit, {
        tactic: tacticsSelection.bowling,
        priorities: bowlingPlan,
      })
    : null;
  const name = (id) => selected.find((p) => p.id === id)?.name;
  const phaseBowlers = (start, end) => {
    const counts = new Map();
    for (const id of allocation.slice(start, end))
      counts.set(id, (counts.get(id) || 0) + 1);
    return [...counts];
  };
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
            Select 11 players, arrange the batting order, then choose five to
            seven bowlers who will share the 20 overs. No more than four
            overseas players or four legends in the XI. You can own{" "}
            {Number.isFinite(auctionLegendLimit)
              ? `up to ${auctionLegendLimit}`
              : "any number of"}{" "}
            legends in your squad.
          </p>
        </div>
        <div
          className={`xi-counter ${lineupSelection.length === 11 && hasBowlingUnit(bowlerSelection) ? "complete" : ""}`}
        >
          <strong>
            {lineupSelection.length}
            <span>/11</span>
          </strong>
          <span>SELECTED</span>
          <small>{bowlerSelection.length} BOWLERS</small>
        </div>
      </div>
      {room.settings.showRatings && selected.length === 11 && (
        <TeamRatingsStrip
          compact
          ratings={Object.fromEntries(
            ["ovr", "batting", "bowling", "fielding"].map((key) => {
              const group = key === "bowling" && unit.length ? unit : selected;
              return [
                key,
                Math.round(
                  group.reduce((sum, player) => sum + player[key], 0) /
                    group.length,
                ),
              ];
            }),
          )}
          label="SELECTED XI · BOWL FROM SELECTED BOWLERS"
        />
      )}
      <div
        className={`lineup-layout${editingPlan ? " lineup-layout-single" : ""}`}
      >
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
          <div className="lineup-toolbar">
            <div className="lineup-checks">
              <span>
                {selected.some((p) => p.role === "Wicketkeeper")
                  ? "Wicketkeeper selected"
                  : "No specialist keeper selected"}
              </span>
              {unit.length >= 5 &&
                unit.filter((p) => p.bowling >= 60).length < 5 && (
                  <span>Part-timers may need to bowl</span>
                )}
            </div>
            <div className="lineup-toolbar-actions">
              {editingPlan && (
                <button
                  type="button"
                  className="button ghost small"
                  onClick={closeTeamPlan}
                >
                  Back to tournament
                </button>
              )}
              <button
                type="button"
                className="button secondary small"
                disabled={locked || !me?.suggestedPlan}
                onClick={suggestPlan}
              >
                Suggest XI
              </button>
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
                    disabled={locked || blockedByLegendLimit}
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
                                ? "✓ PREFERRED POSITION · +8% RUN ODDS"
                                : `Preferred: ${formatPreferredPositions(prefs)}`}
                            </small>
                          )}
                          {room.settings.showRatings &&
                            playerStrengths(player).length > 0 && (
                              <small className="lineup-player-strengths">
                                {playerStrengths(player).join(" · ")}
                              </small>
                            )}
                        </div>
                        <div className="order-controls">
                          <button
                            type="button"
                            title="Move up in batting order"
                            aria-label={`Move ${player.name} up`}
                            disabled={locked || index === 0}
                            onClick={() => moveBattingOrder(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            title="Move down in batting order"
                            aria-label={`Move ${player.name} down`}
                            disabled={
                              locked || index === lineupSelection.length - 1
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
                  <h4>Choose your bowlers</h4>
                </div>
                <span
                  className={`detail-count ${hasBowlingUnit(bowlerSelection) ? "complete" : ""}`}
                >
                  {bowlerSelection.length}
                </span>
              </div>
              <p>
                Select five to seven bowling options. Each can bowl up to four
                overs; change the selection if you prefer.
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
                            locked ||
                            (!checked &&
                              bowlerSelection.length >= maxBowlingOptions)
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
          <section className="lineup-detail-panel lineup-plan-panel">
            <div className="lineup-detail-heading">
              <h4>Bowling priorities</h4>
            </div>
            <div className="plan-controls">
              {[
                ["powerplay", "Powerplay lead", "Overs 1 and 3"],
                ["death", "Death lead", "Overs 17 and 19"],
                ["backup", "Backup bowler", "Requires 6+ bowlers"],
              ].map(([role, label, hint]) => (
                <label key={role}>
                  <span>{label}</span>
                  <select
                    className="arena-select"
                    disabled={locked || (role === "backup" && unit.length < 6)}
                    value={
                      unit.some((p) => p.id === bowlingPlan[role])
                        ? bowlingPlan[role]
                        : ""
                    }
                    onChange={(event) => {
                      const id = event.target.value;
                      setBowlingPlan((old) => {
                        const next = { ...old, [role]: id };
                        if (role !== "backup" && next.backup === id)
                          next.backup = "";
                        return next;
                      });
                    }}
                  >
                    <option value="">Automatic</option>
                    {unit
                      .filter(
                        (p) =>
                          role !== "backup" ||
                          ![bowlingPlan.powerplay, bowlingPlan.death].includes(
                            p.id,
                          ),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <small>{hint}</small>
                </label>
              ))}
            </div>
            {allocation && (
              <details className="plan-preview">
                <summary className="arena-disclosure">
                  Preview over allocation
                </summary>
                <div className="plan-phases">
                  {[
                    ["Powerplay", 0, 6],
                    ["Middle overs", 6, 15],
                    ["Death overs", 15, 20],
                  ].map(([phase, start, end]) => (
                    <section key={phase}>
                      <h5>{phase}</h5>
                      <dl>
                        {phaseBowlers(start, end).map(([id, overs]) => (
                          <div key={id}>
                            <dt>{name(id)}</dt>
                            <dd>{overs} ov</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
              </details>
            )}
          </section>
          <details className="lineup-detail-panel lineup-super-over">
            <summary className="arena-disclosure">Super Over plan</summary>
            <div className="plan-controls">
              {[0, 1, 2].map((index) => (
                <label key={index}>
                  <span>Batter {index + 1}</span>
                  <select
                    className="arena-select"
                    disabled={locked}
                    value={
                      name(superOverPlan.batters?.[index])
                        ? superOverPlan.batters[index]
                        : ""
                    }
                    onChange={(event) => {
                      const id = event.target.value;
                      const batters = [...(superOverPlan.batters || [])];
                      batters[index] = id;
                      setSuperOverPlan((old) => ({ ...old, batters }));
                    }}
                  >
                    <option value="">Automatic</option>
                    {selected
                      .filter(
                        (p) =>
                          !(superOverPlan.batters || []).some(
                            (id, slot) => id === p.id && slot !== index,
                          ),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
              <label>
                <span>Bowler</span>
                <select
                  className="arena-select"
                  disabled={locked}
                  value={name(superOverPlan.bowler) ? superOverPlan.bowler : ""}
                  onChange={(event) => {
                    const bowler = event.target.value;
                    setSuperOverPlan((old) => ({ ...old, bowler }));
                  }}
                >
                  <option value="">Automatic</option>
                  {selected.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <section className="lineup-detail-panel lineup-plan-panel">
            <div className="lineup-detail-heading">
              <h4>Match tactics</h4>
            </div>
            <div className="tactics-grid">
              {Object.entries(TACTIC_OPTIONS).map(([group, config]) => {
                const active = config.options.find(
                  (option) => tacticsSelection[group] === option.id,
                );
                return (
                  <fieldset className="tactic-group" key={group}>
                    <legend>{config.title}</legend>
                    <div className="tactic-options">
                      {config.options.map((option) => (
                        <button
                          type="button"
                          key={option.id}
                          disabled={locked}
                          aria-pressed={tacticsSelection[group] === option.id}
                          onClick={() => setTactic(group, option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {active && (
                      <div className="tactic-notes">
                        <p>{active.description}</p>
                        {active.tradeoff && <small>{active.tradeoff}</small>}
                      </div>
                    )}
                  </fieldset>
                );
              })}
            </div>
          </section>
          <div className="lineup-bottom">
            <span>
              {lineupSelection.length === 11 && hasBowlingUnit(bowlerSelection)
                ? "XI, batting order, bowling unit and tactics are ready."
                : `${Math.max(0, 11 - lineupSelection.length)} XI spots · ${Math.max(0, 5 - bowlerSelection.length)} bowling spots remaining.`}
            </span>
            {locked ? (
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
                  lineupSelection.length !== 11 ||
                  !hasBowlingUnit(bowlerSelection)
                }
                onClick={saveLineup}
              >
                {editingPlan ? "Save match plan" : "Submit match plan →"}
              </button>
            )}
          </div>
        </section>
        {!editingPlan && (
          <aside className="lineup-aside">
            <div className="glass-card lineup-status-card">
              <span className="section-kicker">LEAGUE READINESS</span>
              <h3>All teams need to be ready.</h3>
              <p>
                The league starts after each player locks in their XI, batting
                order and bowling unit.
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
                      {u.bowlerIds?.length || 0} bowlers
                      {!u.connected ? " · OFFLINE" : ""}
                    </span>
                  </div>
                  <b
                    className={
                      u.xiReady &&
                      u.lineup?.length === 11 &&
                      hasBowlingUnit(u.bowlerIds)
                        ? "ready"
                        : ""
                    }
                  >
                    {u.xiReady &&
                    u.lineup?.length === 11 &&
                    hasBowlingUnit(u.bowlerIds)
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
        )}
      </div>
    </main>
  );
}

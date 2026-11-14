import { useEffect, useRef, useState } from "react";
import { TeamLogo } from "../components/Brand";
import {
  LeaderCard,
  LeagueTable,
  FinalistsScreen,
  ChampionScreen,
} from "../components/Tournament";

function TossPanel({ toss, team, isWinner, paused, onChoose }) {
  const [remaining, setRemaining] = useState(toss.remainingMs);
  const panel = useRef(null);
  useEffect(() => {
    if (isWinner && !paused)
      panel.current?.scrollIntoView({ block: "nearest" });
  }, [isWinner, paused]);
  useEffect(() => {
    if (paused) return;
    const deadline = performance.now() + toss.remainingMs;
    const update = () =>
      setRemaining(Math.max(0, deadline - performance.now()));
    update();
    const timer = window.setInterval(update, 50);
    return () => window.clearInterval(timer);
  }, [toss.remainingMs, paused]);

  return (
    <section className="toss-panel" aria-label="Match toss" ref={panel}>
      <div className="live-score-header">
        <span>MATCH TOSS</span>
        {!paused && (
          <span className="toss-clock" aria-hidden="true">
            {Math.ceil(remaining / 1000)}s
          </span>
        )}
      </div>
      <div className="toss-row">
        <TeamLogo
          teamKey={team?.teamShort}
          short={team?.teamShort}
          className="toss-crest"
        />
        <div className="toss-copy" role="status">
          <strong>{team?.teamName} won the toss</strong>
          <small>
            {paused
              ? "Waiting for the host to resume."
              : isWinner
                ? "Choose within 3 seconds."
                : "Waiting for the toss winner to choose."}
          </small>
        </div>
        {isWinner && !paused && (
          <div className="toss-actions">
            <button
              type="button"
              className="button secondary small"
              disabled={remaining <= 0}
              onClick={() => onChoose("bat")}
            >
              Bat first
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={remaining <= 0}
              onClick={() => onChoose("bowl")}
            >
              Bowl first
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function SimulationScreen(props) {
  const {
    room,
    openStats,
    isHost,
    hostAction,
    currentMatch,
    meId,
    chooseToss,
    currentBall,
    ballTrail,
    matchBanner,
    getTeam,
    openTeamPlan,
  } = props;
  const [overSummary, setOverSummary] = useState(false);
  const result =
    currentMatch?.result ||
    (matchBanner?.result?.id === currentMatch?.id ? matchBanner?.result : null);
  const toss = currentMatch?.toss;
  const waitingForToss = toss && !toss.decision;
  const tossWinner = toss && getTeam(room, toss.winnerId);
  const tossSummary =
    toss?.decision &&
    `${tossWinner?.teamShort} won the toss · ${toss.automatic ? "Auto-selected to" : "Chose to"} ${toss.decision} first`;
  const runsNeeded = Math.max(
    0,
    (currentBall?.target || 0) - (currentBall?.score || 0),
  );
  const ballsLeft = Math.max(
    0,
    (currentBall?.maxBalls || (currentBall?.superOver ? 6 : 120)) -
      (currentBall?.balls || 0),
  );
  const displayBall =
    overSummary && currentBall && !currentBall.inningsEnded
      ? currentBall.completedOver || {
          ...currentBall,
          score: 0,
          wickets: 0,
          overs: "0.0",
          commentary: "Waiting for the first completed over.",
        }
      : currentBall;
  return (
    <main className="wrap page-content sim-page">
      {room.phase === "complete" ? (
        <ChampionScreen room={room} openStats={openStats} isHost={isHost} />
      ) : room.phase === "finalReady" ? (
        <FinalistsScreen
          room={room}
          isHost={isHost}
          onStart={() => hostAction("host:startFinal")}
          openTeamPlan={openTeamPlan}
        />
      ) : (
        <>
          <div className="sim-topline">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" />{" "}
                {room.phase === "league"
                  ? "LIVE MATCH CENTRE"
                  : room.phase === "playoffs"
                    ? "PLAYOFFS"
                    : room.phase === "final"
                      ? "THE GRAND FINAL"
                      : "LEAGUE PHASE COMPLETE"}
              </div>
              <h2>
                {room.phase === "league" ? (
                  <>
                    The league is <em>live.</em>
                  </>
                ) : room.phase === "playoffs" ? (
                  <>
                    Win or <em>go home.</em>
                  </>
                ) : room.phase === "final" ? (
                  <>
                    One trophy. <em>One champion.</em>
                  </>
                ) : (
                  <>
                    League stage <em>complete.</em>
                  </>
                )}
              </h2>
            </div>
            <div className="sim-progress">
              <span>
                {room.phase === "league"
                  ? `MATCH ${Math.min(room.matchCount + 1, room.totalLeagueMatches)} / ${room.totalLeagueMatches}`
                  : room.phase === "playoffs"
                    ? room.playoff?.round || "PLAYOFFS"
                    : room.phase === "final"
                      ? "FINAL"
                      : `${room.totalLeagueMatches} MATCHES`}
              </span>
              <span className="sim-progress-dot" />
            </div>
          </div>
          {room.currentMatch && (
            <div className="match-heading">
              <div
                className="match-team home"
                style={{ "--team-color": currentMatch?.home?.teamColor }}
              >
                <TeamLogo
                  teamKey={currentMatch?.home?.teamShort}
                  short={currentMatch?.home?.teamShort}
                  className="match-crest"
                  title={currentMatch?.home?.teamName}
                />
                <div>
                  <strong>{currentMatch?.home?.teamName}</strong>
                  <span>{currentMatch?.home?.name}</span>
                </div>
              </div>
              <div className="versus">
                <span>{currentMatch?.round || "LEAGUE MATCH"}</span>
                <b>VS</b>
                <i>
                  {result ? "FINAL SCORE" : waitingForToss ? "TOSS" : "LIVE"}
                </i>
              </div>
              <div
                className="match-team away"
                style={{ "--team-color": currentMatch?.away?.teamColor }}
              >
                <TeamLogo
                  teamKey={currentMatch?.away?.teamShort}
                  short={currentMatch?.away?.teamShort}
                  className="match-crest"
                  title={currentMatch?.away?.teamName}
                />
                <div>
                  <strong>{currentMatch?.away?.teamName}</strong>
                  <span>{currentMatch?.away?.name}</span>
                </div>
              </div>
            </div>
          )}
          {room.simulationPaused && (
            <div className="recovery-notice" role="status">
              The saved tournament is paused.{" "}
              {isHost ? (
                <button
                  className="button small secondary"
                  onClick={() => hostAction("host:resumeSimulation")}
                >
                  Resume simulation
                </button>
              ) : (
                "Waiting for the host to resume."
              )}
            </div>
          )}
          <div className="sim-grid">
            <section className="sim-main-col">
              {room.currentMatch ? (
                <div className="glass-card live-score-card">
                  {waitingForToss && (
                    <TossPanel
                      key={currentMatch.id}
                      toss={toss}
                      team={tossWinner}
                      isWinner={meId === toss.winnerId}
                      paused={room.simulationPaused}
                      onChoose={(decision) =>
                        chooseToss(currentMatch.id, decision)
                      }
                    />
                  )}
                  {!result && !waitingForToss && (
                    <div className="replay-controls">
                      <label className="replay-mode">
                        <span>Replay</span>
                        <select
                          className="arena-select"
                          aria-label="Replay view"
                          value={overSummary ? "overs" : "balls"}
                          onChange={(event) =>
                            setOverSummary(event.target.value === "overs")
                          }
                        >
                          <option value="balls">Ball by ball</option>
                          <option value="overs">Over summary</option>
                        </select>
                      </label>
                      {isHost && (
                        <label className="replay-mode">
                          <span>Speed</span>
                          <select
                            className="arena-select"
                            aria-label="Playback speed"
                            value={room.settings.ballIntervalMs}
                            onChange={(event) =>
                              hostAction(
                                "host:replaySpeed",
                                Number(event.target.value),
                              )
                            }
                          >
                            <option value={220}>Relaxed</option>
                            <option value={95}>Standard</option>
                            <option value={45}>Fast</option>
                          </select>
                        </label>
                      )}
                      {isHost &&
                        currentMatch?.live &&
                        !room.simulationPaused && (
                          <button
                            type="button"
                            className="skip-match"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Skip the live animation and move to the result?",
                                )
                              )
                                hostAction("host:skipMatch");
                            }}
                          >
                            Skip animation ↗
                          </button>
                        )}
                    </div>
                  )}
                  {!result && !waitingForToss && (
                    <>
                      {tossSummary && (
                        <p className="toss-summary">{tossSummary}</p>
                      )}
                      <div className="live-score-header">
                        <span className="live-pulse">
                          <i /> IN PLAY
                        </span>
                        <span>
                          {displayBall?.superOver
                            ? `SUPER OVER ${displayBall.superOverRound || 1}`
                            : displayBall?.inningsIndex === 1
                              ? "2ND INNINGS"
                              : "1ST INNINGS"}
                          {displayBall?.target
                            ? ` · TARGET ${displayBall.target}`
                            : ""}
                        </span>
                        <span>
                          {result?.innings?.[1]?.overs ||
                            displayBall?.overs ||
                            "0.0"}{" "}
                          OVERS
                        </span>
                      </div>
                      <div className="scoreline">
                        <span className="score-team-label">
                          {displayBall?.battingTeamId ||
                          displayBall?.battingTeamName
                            ? room.users.find(
                                (u) => u.id === displayBall?.battingTeamId,
                              )?.teamShort ||
                              displayBall?.battingTeamName
                                ?.slice(0, 3)
                                .toUpperCase()
                            : "—"}
                        </span>
                        <strong>
                          {result?.innings?.[1]?.runs ??
                            displayBall?.score ??
                            0}
                          <small>/</small>
                          {result?.innings?.[1]?.wickets ??
                            displayBall?.wickets ??
                            0}
                        </strong>
                        <span className="score-overs">
                          {result?.innings?.[1]?.overs ||
                            displayBall?.overs ||
                            "0.0"}{" "}
                          <i>overs</i>
                        </span>
                        <span className="score-opponent-label">
                          {currentMatch?.homeId === displayBall?.battingTeamId
                            ? currentMatch?.away?.teamShort
                            : currentMatch?.home?.teamShort}
                        </span>
                      </div>
                      {!result && !overSummary && displayBall?.target && (
                        <div className="target-line">
                          <span>TARGET {displayBall.target}</span>
                          <b>
                            {runsNeeded} needed off {ballsLeft}
                          </b>
                          <span>
                            Required RR{" "}
                            {ballsLeft
                              ? ((runsNeeded * 6) / ballsLeft).toFixed(2)
                              : "—"}
                          </span>
                        </div>
                      )}
                      <div className="live-score-separator" />
                      <div className="live-batters">
                        <div className="player-score-row">
                          <div className="batter-mark">✦</div>
                          <div className="player-score-name">
                            <strong>
                              {displayBall?.batter1?.name ||
                                "Awaiting first ball"}
                            </strong>
                            <span>
                              {displayBall?.batter1
                                ? `${displayBall.batter1.balls} balls faced`
                                : "Opening batter"}
                            </span>
                          </div>
                          <strong className="batter-runs">
                            {displayBall?.batter1?.runs ?? 0}
                            <small> ({displayBall?.batter1?.balls ?? 0})</small>
                            {displayBall?.batter1 && !displayBall.batter1.out
                              ? "*"
                              : ""}
                          </strong>
                        </div>
                        <div className="player-score-row">
                          <div className="batter-mark muted-mark">◇</div>
                          <div className="player-score-name">
                            <strong>{displayBall?.batter2?.name || "—"}</strong>
                            <span>
                              {displayBall?.batter2
                                ? `${displayBall.batter2.balls} balls faced`
                                : "Non-striker"}
                            </span>
                          </div>
                          <strong className="batter-runs">
                            {displayBall?.batter2?.runs ?? 0}
                            <small> ({displayBall?.batter2?.balls ?? 0})</small>
                            {displayBall?.batter2 && !displayBall.batter2.out
                              ? "*"
                              : ""}
                          </strong>
                        </div>
                        <div className="player-score-row bowler-row">
                          <div className="bowler-mark">↘</div>
                          <div className="player-score-name">
                            <strong>
                              {displayBall?.bowler?.name || "Bowler"}
                            </strong>
                            <span>BOWLING</span>
                          </div>
                          <strong className="bowler-figures">
                            {displayBall?.bowler?.wickets ?? 0}/
                            {displayBall?.bowler?.runs ?? 0}
                            <small>
                              {" "}
                              ({displayBall?.bowler?.overs || "0.0"})
                            </small>
                          </strong>
                        </div>
                      </div>
                      <div className="scorecard-bottom">
                        <div className="last-ball-strip">
                          <span>
                            {overSummary ? "OVER END BALLS" : "RECENT BALLS"}
                          </span>
                          <div>
                            {(overSummary
                              ? ballTrail.filter((ball) => ball.overEnd)
                              : ballTrail
                            ).map((b, i) => (
                              <i
                                key={b.key || i}
                                className={`${b.wicket ? "wicket-ball" : b.runs === 6 ? "six-ball" : b.runs === 4 ? "four-ball" : ""}`}
                              >
                                {b.wicket
                                  ? "W"
                                  : {
                                      wide: "Wd",
                                      noBall: "Nb",
                                      bye: "B",
                                      legBye: "Lb",
                                    }[b.extraType] ||
                                    (b.runs > 0 ? b.runs : "·")}
                              </i>
                            ))}
                          </div>
                        </div>
                        <div className="commentary-line">
                          <i />
                          {displayBall?.freeHit && "Free hit · "}
                          {displayBall?.commentary ||
                            "The bowler is marking the run-up…"}
                        </div>
                      </div>
                    </>
                  )}
                  {result && (
                    <section className="match-result">
                      <div className="live-score-header">MATCH RESULT</div>
                      <h3>
                        {result.winnerId
                          ? `${getTeam(room, result.winnerId)?.teamName} win`
                          : "Match tied"}
                      </h3>
                      <small>{result.margin}</small>
                      {tossSummary && (
                        <p className="toss-summary">{tossSummary}</p>
                      )}
                      <ul className="match-final-scores">
                        {[
                          ...(result.innings || []),
                          ...(result.superOver || []),
                        ].map((innings, index) => (
                          <li key={index}>
                            {index >= 2 && index % 2 === 0 && (
                              <span className="match-score-phase">
                                Super Over {Math.floor(index / 2)}
                              </span>
                            )}
                            <span>{innings.battingTeamName}</span>
                            <b>
                              {innings.runs}/{innings.wickets}
                            </b>
                            <small>{innings.overs} ov</small>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              ) : room.phase === "leagueComplete" ? (
                <div className="glass-card phase-complete-card">
                  <div className="phase-icon">✓</div>
                  <span className="section-kicker">EVERY MATCH COUNTS</span>
                  <h3>The league table is final.</h3>
                  <p>
                    The top four teams qualify for the IPL-style playoffs:
                    Qualifier 1, Eliminator, and Qualifier 2.
                  </p>
                  <div className="stage-actions">
                    {openTeamPlan && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={openTeamPlan}
                      >
                        Edit team plan
                      </button>
                    )}
                    {isHost && (
                      <button
                        className="button primary"
                        onClick={() => hostAction("host:startPlayoffs")}
                      >
                        Start playoff simulation <span>↗</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="glass-card phase-complete-card">
                  <div className="loading-ring" />
                  <h3>Preparing the next match…</h3>
                </div>
              )}
              <div className="glass-card table-card">
                <div className="panel-header">
                  <div>
                    <span className="section-kicker">POINTS TABLE</span>
                    <h3>
                      {room.phase === "league"
                        ? "League standings"
                        : "Final league table"}
                    </h3>
                  </div>
                  <span className="table-note">2 PTS FOR A WIN</span>
                </div>
                <LeagueTable room={room} />
              </div>
            </section>
            <aside className="sim-rail">
              <LeaderCard
                title="ORANGE CAP"
                accent="orange"
                value={room.playerLeaders?.orangeCap?.[0]}
                metric="runs"
                onClick={() => openStats("orangeCap")}
              />
              <LeaderCard
                title="PURPLE CAP"
                accent="purple"
                value={room.playerLeaders?.purpleCap?.[0]}
                metric="wickets"
                onClick={() => openStats("purpleCap")}
              />
              <LeaderCard
                title="TOURNAMENT MVP"
                accent="mvp"
                value={room.playerLeaders?.mvp?.[0]}
                metric="mvpScore"
                onClick={() => openStats("mvp")}
              />
              <button
                className="more-stats-card"
                onClick={() => openStats("more")}
              >
                <span className="stats-icon">▤</span>
                <span>
                  <strong>More stats</strong>
                  <small>Records, form & leaderboards</small>
                </span>
                <b>↗</b>
              </button>
              <div className="glass-card fixtures-card">
                <div className="panel-header">
                  <div>
                    <span className="section-kicker">RECENT RESULTS</span>
                    <h3>Last matches</h3>
                  </div>
                </div>
                {room.matchResults
                  ?.slice(-4)
                  .reverse()
                  .map((m) => (
                    <div className="fixture-result" key={m.id}>
                      <span className="fixture-round">
                        {m.round || "LEAGUE"}
                      </span>
                      <div>
                        <strong>
                          {getTeam(room, m.winnerId)?.teamShort || "TIE"}{" "}
                          <span>won</span>
                        </strong>
                        <small>{m.margin}</small>
                      </div>
                      <i>✓</i>
                    </div>
                  ))}
                {!room.matchResults?.length && (
                  <p className="muted empty-copy">
                    Results appear here as matches finish.
                  </p>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

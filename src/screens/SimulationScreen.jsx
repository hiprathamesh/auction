import { TeamLogo } from "../components/Brand";
import {
  LeaderCard,
  LeagueTable,
  FinalistsScreen,
  ChampionScreen,
} from "../components/Tournament";

export function SimulationScreen(props) {
  const {
    room,
    openStats,
    isHost,
    hostAction,
    currentMatch,
    currentBall,
    ballTrail,
    matchBanner,
    getTeam,
  } = props;
  return (
    <main className="wrap page-content sim-page">
      {room.phase === "complete" ? (
        <ChampionScreen room={room} openStats={openStats} />
      ) : room.phase === "finalReady" ? (
        <FinalistsScreen
          room={room}
          isHost={isHost}
          onStart={() => hostAction("host:startFinal")}
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
                <i>LIVE</i>
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
                  <div className="live-score-header">
                    <span className="live-pulse">
                      <i /> IN PLAY
                    </span>
                    <span>
                      {currentBall?.superOver
                        ? "SUPER OVER"
                        : currentBall?.inningsIndex === 1
                          ? "2ND INNINGS"
                          : "1ST INNINGS"}
                      {currentBall?.target
                        ? ` · TARGET ${currentBall.target}`
                        : ""}
                    </span>
                    <span>{currentBall?.overs || "0.0"} OVERS</span>
                  </div>
                  <div className="scoreline">
                    <span className="score-team-label">
                      {currentBall?.battingTeamId ||
                      currentBall?.battingTeamName
                        ? room.users.find(
                            (u) => u.id === currentBall?.battingTeamId,
                          )?.teamShort ||
                          currentBall?.battingTeamName
                            ?.slice(0, 3)
                            .toUpperCase()
                        : "—"}
                    </span>
                    <strong>
                      {currentBall?.score ?? 0}
                      <small>/</small>
                      {currentBall?.wickets ?? 0}
                    </strong>
                    <span className="score-overs">
                      {currentBall?.overs || "0.0"} <i>overs</i>
                    </span>
                    <span className="score-opponent-label">
                      {currentMatch?.homeId === currentBall?.battingTeamId
                        ? currentMatch?.away?.teamShort
                        : currentMatch?.home?.teamShort}
                    </span>
                  </div>
                  {currentBall?.target && (
                    <div className="target-line">
                      <span>TARGET {currentBall.target}</span>
                      <b>
                        {Math.max(
                          0,
                          currentBall.target - (currentBall.score || 0),
                        )}{" "}
                        runs needed
                      </b>
                      <span>
                        Required RR{" "}
                        {currentBall?.balls
                          ? (
                              Math.max(
                                0,
                                currentBall.target - (currentBall.score || 0),
                              ) / Math.max(0.1, (120 - currentBall.balls) / 6)
                            ).toFixed(2)
                          : "0.00"}
                      </span>
                    </div>
                  )}
                  <div className="live-score-separator" />
                  <div className="live-batters">
                    <div className="player-score-row">
                      <div className="batter-mark">✦</div>
                      <div className="player-score-name">
                        <strong>
                          {currentBall?.batter1?.name || "Awaiting first ball"}
                        </strong>
                        <span>
                          {currentBall?.batter1
                            ? `${currentBall.batter1.balls} balls faced`
                            : "Opening batter"}
                        </span>
                      </div>
                      <strong className="batter-runs">
                        {currentBall?.batter1?.runs ?? 0}
                        <small> ({currentBall?.batter1?.balls ?? 0})</small>
                        {currentBall?.batter1 && !currentBall.batter1.out
                          ? "*"
                          : ""}
                      </strong>
                    </div>
                    <div className="player-score-row">
                      <div className="batter-mark muted-mark">◇</div>
                      <div className="player-score-name">
                        <strong>{currentBall?.batter2?.name || "—"}</strong>
                        <span>
                          {currentBall?.batter2
                            ? `${currentBall.batter2.balls} balls faced`
                            : "Non-striker"}
                        </span>
                      </div>
                      <strong className="batter-runs">
                        {currentBall?.batter2?.runs ?? 0}
                        <small> ({currentBall?.batter2?.balls ?? 0})</small>
                        {currentBall?.batter2 && !currentBall.batter2.out
                          ? "*"
                          : ""}
                      </strong>
                    </div>
                    <div className="player-score-row bowler-row">
                      <div className="bowler-mark">↘</div>
                      <div className="player-score-name">
                        <strong>{currentBall?.bowler?.name || "Bowler"}</strong>
                        <span>BOWLING</span>
                      </div>
                      <strong className="bowler-figures">
                        {currentBall?.bowler?.wickets ?? 0}/
                        {currentBall?.bowler?.runs ?? 0}
                        <small> ({currentBall?.bowler?.overs || "0.0"})</small>
                      </strong>
                    </div>
                  </div>
                  <div className="scorecard-bottom">
                    <div className="last-ball-strip">
                      <span>RECENT BALLS</span>
                      <div>
                        {ballTrail.map((b, i) => (
                          <i
                            key={b.key || i}
                            className={`${b.wicket ? "wicket-ball" : b.runs === 6 ? "six-ball" : b.runs === 4 ? "four-ball" : ""}`}
                          >
                            {b.wicket ? "W" : b.runs > 0 ? b.runs : "·"}
                          </i>
                        ))}
                      </div>
                    </div>
                    <div className="commentary-line">
                      <i />
                      {currentBall?.commentary ||
                        "The bowler is marking the run-up…"}
                    </div>
                  </div>
                  {matchBanner?.result && (
                    <div className="match-result-flash">
                      <span>MATCH RESULT</span>
                      <strong>
                        {matchBanner.result.winnerId
                          ? `${getTeam(room, matchBanner.result.winnerId)?.teamName} WIN`
                          : "MATCH TIED"}
                      </strong>
                      <small>{matchBanner.result.margin}</small>
                    </div>
                  )}
                  {isHost && !room.simulationPaused && (
                    <button
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
              ) : room.phase === "leagueComplete" ? (
                <div className="glass-card phase-complete-card">
                  <div className="phase-icon">✓</div>
                  <span className="section-kicker">EVERY MATCH COUNTS</span>
                  <h3>The league table is final.</h3>
                  <p>
                    The top four teams qualify for the IPL-style playoffs:
                    Qualifier 1, Eliminator, and Qualifier 2.
                  </p>
                  {isHost && (
                    <button
                      className="button primary"
                      onClick={() => hostAction("host:startPlayoffs")}
                    >
                      Start playoff simulation <span>↗</span>
                    </button>
                  )}
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

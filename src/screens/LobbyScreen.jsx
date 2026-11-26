import { TeamLogo } from "../components/Brand";

function RetentionOptions({
  seasonId,
  limit,
  retention,
  ready,
  online,
  select,
}) {
  const { candidates = [], selected = [] } = retention || {};
  return (
    <fieldset className="retention-options">
      <legend>Player Retain</legend>
      {candidates.length ? (
        <>
          <p>
            {selected.length}/{limit} selected from S
            {String(seasonId).padStart(2, "0")}. Picks join your squad for free
            before bidding.
            {ready && " Undo ready to change your picks."}
          </p>
          <div className="retention-list">
            {candidates.map((player) => {
              const checked = selected.includes(player.id);
              return (
                <label key={player.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      !online || ready || (!checked && selected.length >= limit)
                    }
                    onChange={(event) =>
                      select(player.id, event.target.checked)
                    }
                  />
                  <span>
                    <strong>{player.name}</strong>
                    <small>
                      {player.role}
                      {player.overseas && " · Overseas"}
                      {player.legend && " · Legend"}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
        </>
      ) : (
        <p>
          {seasonId
            ? "You have no eligible players from the previous recorded season."
            : "No previous recorded season is available."}
        </p>
      )}
    </fieldset>
  );
}

export function LobbyScreen(props) {
  const {
    copyInvite,
    shareCopied,
    room,
    meId,
    isHost,
    kickUser,
    setSetting,
    me,
    emitAction,
    appOnline,
    allReady,
    hostAction,
    identity,
    retention,
  } = props;
  return (
    <main className="wrap page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> ROOM SETUP
          </div>
          <h2>
            Lock in your <em>auction room.</em>
          </h2>
          <p>
            Everyone picks a franchise, gets ready, and the host sets the rules.
          </p>
        </div>
        <button className="button ghost" onClick={copyInvite}>
          {shareCopied ? "Copied invite" : "↗ Share invite"}
        </button>
      </div>
      <div className="lobby-grid">
        <section className="glass-card players-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">THE DRAFT ROOM</span>
              <h3>
                Who's playing{" "}
                <span className="muted">({room.users.length}/10)</span>
              </h3>
            </div>
            <div className="ready-meter">
              <span>{room.users.filter((u) => u.ready).length}</span> /{" "}
              {room.users.length} READY
            </div>
          </div>
          <div className="room-code-block">
            <div>
              <span className="field-label">ROOM CODE</span>
              <strong>{room.code}</strong>
              <p>
                {room.settings.identifiedOnly
                  ? "Share the invite with friends. They need an identity to join."
                  : "Share the code or invite link. Friends can still join mid-auction."}
              </p>
            </div>
            <button className="square-button" onClick={copyInvite}>
              ⧉
            </button>
          </div>
          <div className="participant-list">
            {room.users.map((u, i) => (
              <div
                className="participant"
                key={u.id}
                style={{ "--team-color": u.teamColor }}
              >
                <div className="participant-index">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <TeamLogo
                  teamKey={u.teamShort}
                  short={u.teamShort}
                  className="participant-crest"
                  title={u.teamName}
                />
                <div className="participant-info">
                  <strong>
                    {u.name}
                    {u.id === meId ? <span className="you-tag">YOU</span> : ""}
                  </strong>
                  <span>{u.teamName}</span>
                </div>
                <div className="participant-status">
                  {u.isHost && <span className="host-tag">HOST</span>}
                  <span className={`status-pill ${u.ready ? "ready" : ""}`}>
                    <i />
                    {u.ready ? "Ready" : "Waiting"}
                  </span>
                </div>
                <div
                  className={`participant-online ${u.connected ? "connected" : ""}`}
                  title={u.connected ? "Connected" : "Disconnected"}
                />
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
          </div>
          <div className="participant-footer">
            <span>
              <i className="online-dot" />{" "}
              {room.users.filter((u) => u.connected).length} connected
            </span>
            <span>2–3 teams: league-only test · 4+ teams: playoffs</span>
          </div>
          {room.settings.retentionEnabled && (
            <RetentionOptions
              seasonId={room.previousSeasonId}
              limit={room.settings.retentionLimit ?? 1}
              retention={retention}
              ready={me?.ready}
              online={appOnline}
              select={(playerId, selected) =>
                emitAction("lobby:retain", { playerId, selected })
              }
            />
          )}
        </section>
        <section className="glass-card settings-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">HOST CONTROLS</span>
              <h3>Auction rules</h3>
            </div>
            <span className="lock-icon">⌘</span>
          </div>
          {isHost ? (
            <>
              {identity && (
                <>
                  <div className="setting-row">
                    <div>
                      <strong>Record this season</strong>
                      <p>
                        Save the completed season to every identified
                        participant’s Hub.
                      </p>
                    </div>
                    <button
                      className={`toggle ${room.settings.recordSeason ? "on" : ""}`}
                      onClick={() =>
                        setSetting("recordSeason", !room.settings.recordSeason)
                      }
                      aria-label="Toggle season recording"
                      aria-pressed={Boolean(room.settings.recordSeason)}
                    >
                      <i />
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Only allow identified users</strong>
                      <p>Require an Arena identity to join this room.</p>
                    </div>
                    <button
                      className={`toggle ${room.settings.identifiedOnly ? "on" : ""}`}
                      onClick={() =>
                        setSetting(
                          "identifiedOnly",
                          !room.settings.identifiedOnly,
                        )
                      }
                      aria-label="Only allow identified users"
                      aria-pressed={Boolean(room.settings.identifiedOnly)}
                    >
                      <i />
                    </button>
                  </div>
                </>
              )}
              <div className="setting-row">
                <div>
                  <strong>Starting purse</strong>
                  <p>Same purse for every team</p>
                </div>
                <select
                  value={room.settings.startingPurse}
                  onChange={(e) =>
                    setSetting("startingPurse", Number(e.target.value))
                  }
                >
                  <option value={60}>₹60 Cr</option>
                  <option value={80}>₹80 Cr</option>
                  <option value={100}>₹100 Cr</option>
                  <option value={120}>₹120 Cr · Default</option>
                  <option value={150}>₹150 Cr</option>
                  <option value={200}>₹200 Cr</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Bid timer</strong>
                  <p>Resets after every bid</p>
                </div>
                <select
                  value={room.settings.bidSeconds}
                  onChange={(e) =>
                    setSetting("bidSeconds", Number(e.target.value))
                  }
                >
                  <option value={5}>5 seconds</option>
                  <option value={10}>10 seconds · Default</option>
                  <option value={15}>15 seconds</option>
                  <option value={20}>20 seconds</option>
                  <option value={30}>30 seconds</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Show player ratings</strong>
                  <p>Reveal OVR + skill ratings during bids</p>
                </div>
                <button
                  className={`toggle ${room.settings.showRatings ? "on" : ""}`}
                  onClick={() =>
                    setSetting("showRatings", !room.settings.showRatings)
                  }
                  aria-label="Toggle player ratings"
                >
                  <i />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Retired IPL legends</strong>
                  <p>Add 59 boosted legends in Marquee Set 1</p>
                </div>
                <button
                  className={`toggle ${room.settings.includeLegends ? "on" : ""}`}
                  onClick={() =>
                    setSetting("includeLegends", !room.settings.includeLegends)
                  }
                  aria-label="Toggle retired legends"
                >
                  <i />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Auction pool</strong>
                  <p>
                    Compact scales to room size and brings depth players
                    forward.
                  </p>
                </div>
                <select
                  className="arena-select"
                  aria-label="Auction pool"
                  value={room.settings.compactAuction ? "compact" : "full"}
                  onChange={(event) =>
                    setSetting(
                      "compactAuction",
                      event.target.value === "compact",
                    )
                  }
                >
                  <option value="compact">Compact</option>
                  <option value="full">Full pool</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Legend purchase limit</strong>
                  <p>Maximum legends each team may buy</p>
                </div>
                <select
                  value={room.settings.legendAuctionLimit ?? 6}
                  onChange={(e) =>
                    setSetting(
                      "legendAuctionLimit",
                      e.target.value === "unlimited"
                        ? "unlimited"
                        : Number(e.target.value),
                    )
                  }
                >
                  <option value={4}>4 legends</option>
                  <option value={5}>5 legends</option>
                  <option value={6}>6 legends · Default</option>
                  <option value={7}>7 legends</option>
                  <option value={8}>8 legends</option>
                  <option value="unlimited">No limit</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Right to Match</strong>
                  <p>Let the previous season’s manager match the final bid</p>
                </div>
                <button
                  className={`toggle ${room.settings.rtmEnabled ? "on" : ""}`}
                  onClick={() =>
                    setSetting("rtmEnabled", !room.settings.rtmEnabled)
                  }
                  aria-label="Toggle Right to Match"
                  aria-pressed={Boolean(room.settings.rtmEnabled)}
                >
                  <i />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Reveal RTM activation publicly</strong>
                  <p>
                    When off, only the manager with RTM sees the live ON/OFF
                    state
                  </p>
                </div>
                <button
                  className={`toggle ${room.settings.rtmPublicStatus !== false ? "on" : ""}`}
                  disabled={!room.settings.rtmEnabled}
                  onClick={() =>
                    setSetting(
                      "rtmPublicStatus",
                      room.settings.rtmPublicStatus === false,
                    )
                  }
                  aria-label="Toggle public RTM activation visibility"
                >
                  <i />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>RTM uses per manager</strong>
                  <p>Maximum times each manager can exercise RTM</p>
                </div>
                <select
                  value={room.settings.rtmUses ?? 1}
                  disabled={!room.settings.rtmEnabled}
                  onChange={(e) =>
                    setSetting("rtmUses", Number(e.target.value))
                  }
                >
                  <option value={1}>1 use</option>
                  <option value={2}>2 uses</option>
                  <option value={3}>3 uses</option>
                  <option value={4}>4 uses</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Player Retain</strong>
                  <p>Keep eligible players from last season’s squad for free</p>
                </div>
                <button
                  className={`toggle ${room.settings.retentionEnabled ? "on" : ""}`}
                  onClick={() =>
                    setSetting(
                      "retentionEnabled",
                      !room.settings.retentionEnabled,
                    )
                  }
                  aria-label="Toggle Player Retain"
                  aria-pressed={Boolean(room.settings.retentionEnabled)}
                >
                  <i />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Retentions per manager</strong>
                  <p>
                    Players retained last season cannot be retained again this
                    season
                  </p>
                </div>
                <select
                  aria-label="Retentions per manager"
                  value={room.settings.retentionLimit ?? 1}
                  disabled={!room.settings.retentionEnabled}
                  onChange={(event) =>
                    setSetting("retentionLimit", Number(event.target.value))
                  }
                >
                  <option value={1}>1 player</option>
                  <option value={2}>2 players</option>
                  <option value={3}>3 players</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Extra bid buttons</strong>
                  <p>Pick any multipliers to display beside the normal bid</p>
                </div>
                <div className="settings-multiplier-options">
                  {[2, 3, 5, 8, 10].map((n) => (
                    <label key={n} className="settings-multiplier-choice">
                      <input
                        type="checkbox"
                        checked={(
                          room.settings.bidMultipliers || [2, 5, 10]
                        ).includes(n)}
                        onChange={(e) =>
                          setSetting(
                            "bidMultipliers",
                            [2, 3, 5, 8, 10].filter((m) =>
                              m === n
                                ? e.target.checked
                                : (
                                    room.settings.bidMultipliers || [2, 5, 10]
                                  ).includes(m),
                            ),
                          )
                        }
                      />
                      ×{n}
                    </label>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Player trading</strong>
                  <p>Allow one-for-one exchanges after the auction</p>
                </div>
                <button
                  className={`toggle ${room.settings.tradesEnabled ? "on" : ""}`}
                  onClick={() =>
                    setSetting("tradesEnabled", !room.settings.tradesEnabled)
                  }
                  aria-label="Toggle player trading"
                >
                  <i />
                </button>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Trades per team</strong>
                  <p>
                    Accepted trades count for both teams; declined offers do not
                  </p>
                </div>
                <select
                  disabled={!room.settings.tradesEnabled}
                  value={room.settings.tradeLimit ?? 2}
                  onChange={(e) =>
                    setSetting("tradeLimit", Number(e.target.value))
                  }
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "trade" : "trades"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-footnote">
                <span>ⓘ</span>
                <p>
                  Roster rules: max 25 players, 8 overseas in a squad, and 4
                  overseas plus 4 legends in the playing XI. RTM and retention
                  rights follow identified managers from the previous recorded
                  season.
                </p>
              </div>
            </>
          ) : (
            <div className="host-wait">
              <span className="host-wait-icon">⌘</span>
              <strong>Host is configuring the auction</strong>
              <p>
                Once everyone is ready, the host will start the auction. You can
                change your ready status any time.
              </p>
              <div className="host-user">
                <TeamLogo
                  teamKey={
                    room.users.find((u) => u.id === room.hostId)?.teamShort
                  }
                  short={
                    room.users.find((u) => u.id === room.hostId)?.teamShort
                  }
                  className="avatar-mini"
                  title={room.users.find((u) => u.id === room.hostId)?.teamName}
                />
                <div>
                  <strong>
                    {room.users.find((u) => u.id === room.hostId)?.name}
                  </strong>
                  <span>Room host</span>
                </div>
              </div>
            </div>
          )}
          <div className="settings-action">
            {me?.ready ? (
              <button
                className="button secondary full-button"
                onClick={() => emitAction("lobby:ready", false)}
              >
                ✓ You're ready · Undo
              </button>
            ) : (
              <button
                className="button primary full-button"
                onClick={() => emitAction("lobby:ready", true)}
              >
                I'm ready <span>→</span>
              </button>
            )}
            {isHost && (
              <button
                className="button ghost full-button"
                disabled={!appOnline || !allReady || room.users.length < 2}
                onClick={() => hostAction("host:startAuction")}
              >
                Start auction <span>↗</span>
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

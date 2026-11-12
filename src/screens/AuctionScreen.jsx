import { TeamLogo } from "../components/Brand";
import { AuctionTimer } from "../components/AuctionTimer";
import { playerPath } from "../lib/format";

export function AuctionScreen(props) {
  const {
    room,
    me,
    money,
    myOverseas,
    myKeepers,
    myLegendCount,
    legendLimitLabel,
    sortPlayer,
    roleShort,
    preferredPositions,
    formatPreferredPositions,
    ownSquadOvrs,
    currentLot,
    isMyBid,
    canBidAt,
    placeBid,
    isMyOut,
    legendLimitReached,
    nextBid,
    bidPriceFor,
    configuredMultipliers,
    canMarkOut,
    isMyRtmArmed,
    emitAction,
    rtmIsOnForMe,
    isMyRtmHolder,
    appOnline,
    canArmRtm,
    myRtmRemaining,
    rtmHolder,
    notice,
    expandedBidderId,
    meId,
    setExpandedBidderId,
    isHost,
    kickUser,
    hostAction,
  } = props;
  const profileHref = currentLot ? playerPath(currentLot.player.id) : null;
  const profileLabel = currentLot
    ? `View ${currentLot.player.name}'s profile`
    : "";
  return (
    <main className="wrap page-content auction-page">
      <div className="auction-toolbar">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> THE AUCTION FLOOR
          </div>
          <h2>
            Build your <em>championship squad.</em>
          </h2>
        </div>
        <div className="auction-progress">
          <span>LOT {String(room.auctionLotsDone + 1).padStart(3, "0")}</span>
          <div className="progress-track">
            <i
              style={{
                width: `${Math.min(100, ((room.auctionLotsDone || 0) / Math.max(room.totalLots || 1, 1)) * 100)}%`,
              }}
            />
          </div>
          <span>
            {room.auctionLotsDone} / {room.totalLots}
          </span>
        </div>
      </div>
      <div className="auction-layout">
        <aside className="glass-card auction-myteam">
          <div className="myteam-heading">
            <TeamLogo
              teamKey={me?.teamShort}
              short={me?.teamShort}
              className="team-badge"
              title={me?.teamName}
            />
            <div>
              <span className="section-kicker">YOUR FRANCHISE</span>
              <h3>{me?.teamName}</h3>
              <p>Managed by {me?.name}</p>
            </div>
          </div>
          <div className="purse-display">
            <span>REMAINING PURSE</span>
            <strong>{money(me?.purse)}</strong>
            <div className="purse-bar">
              <i
                style={{
                  width: `${Math.max(0, Math.min(100, ((me?.purse || 0) / room.settings.startingPurse) * 100))}%`,
                }}
              />
            </div>
            <div className="purse-caption">
              <span>
                Spent {money(room.settings.startingPurse - (me?.purse || 0))}
              </span>
              <span>{me?.squadCount || 0} / 25 players</span>
            </div>
          </div>
          <div className="squad-mini-meta">
            <div>
              <strong>{me?.squadCount || 0}</strong>
              <span>SQUAD</span>
            </div>
            <div>
              <strong>{myOverseas}/8</strong>
              <span>OVERSEAS</span>
            </div>
            <div>
              <strong>{myKeepers}</strong>
              <span>KEEPERS</span>
            </div>
            <div>
              <strong>
                {myLegendCount}/{legendLimitLabel}
              </strong>
              <span>LEGENDS</span>
            </div>
          </div>
          <div className="squad-mini-list">
            <div className="mini-list-title squad-list-header">
              YOUR SIGNINGS <span>{me?.squadCount || 0}</span>
            </div>
            {me?.squad?.length ? (
              [
                ["BATTERS", me.squad.filter((p) => p.role === "Batter")],
                [
                  "WICKETKEEPERS",
                  me.squad.filter((p) => p.role === "Wicketkeeper"),
                ],
                [
                  "ALL-ROUNDERS",
                  me.squad.filter((p) => p.role === "All-rounder"),
                ],
                ["BOWLERS", me.squad.filter((p) => p.role === "Bowler")],
              ]
                .filter(([, players]) => players.length)
                .map(([title, players]) => (
                  <div className="mini-squad-group" key={title}>
                    <div className="mini-list-title">
                      {title}
                      <span>{players.length}</span>
                    </div>
                    {players
                      .slice()
                      .sort((a, b) =>
                        sortPlayer(a, b, room.settings.showRatings),
                      )
                      .map((p) => (
                        <div className="mini-player" key={p.id}>
                          <span className="role-chip">{roleShort[p.role]}</span>
                          <div className="mini-player-info">
                            <strong>{p.name}</strong>
                            <span>
                              {p.overseas ? "Overseas" : "Indian"}
                              {preferredPositions(p).length
                                ? ` · BAT ${formatPreferredPositions(preferredPositions(p))}`
                                : ""}
                              {p.legend ? " · LEGEND" : ""}
                            </span>
                            <div className="mini-player-ratings">
                              <span>
                                OVR <b>{p.ovr ?? ownSquadOvrs[p.id] ?? "—"}</b>
                              </span>
                              <span>
                                BAT <b>{p.batting ?? "—"}</b>
                              </span>
                              <span>
                                BOWL <b>{p.bowling ?? "—"}</b>
                              </span>
                              <span>
                                FIELD <b>{p.fielding ?? "—"}</b>
                              </span>
                            </div>
                          </div>
                          <b>
                            {p.retained ? "Retained" : money(p.purchasePrice)}
                          </b>
                        </div>
                      ))}
                  </div>
                ))
            ) : (
              <div className="empty-mini">Your first signing is waiting.</div>
            )}
          </div>
        </aside>
        <section className="auction-center">
          <div className="current-set-label">
            <span className="set-icon">◇</span>
            <span>{currentLot?.set || room.currentSet}</span>
            <span className="set-sub">AUCTION SET</span>
          </div>
          {currentLot ? (
            <div className="glass-card player-auction-card">
              <div className="lot-meta">
                <span>PLAYER ON THE BLOCK</span>
                <span>#{String(currentLot.lotNumber).padStart(3, "0")}</span>
              </div>
              <a
                className="player-avatar-large"
                href={profileHref}
                aria-label={profileLabel}
                style={{
                  "--team-color": currentLot.player.legend
                    ? "#cba4ff"
                    : me?.teamColor,
                }}
              >
                {currentLot.player.photo && (
                  <img
                    className="player-portrait-img"
                    src={currentLot.player.photo}
                    alt={`Portrait of ${currentLot.player.name}`}
                    loading="eager"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                      event.currentTarget.parentElement
                        ?.querySelector(".player-avatar-fallback")
                        ?.classList.remove("is-hidden");
                    }}
                  />
                )}
                <span
                  className={`player-avatar-fallback${currentLot.player.photo ? " is-hidden" : ""}`}
                >
                  {currentLot.player.name
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
                <i>
                  {currentLot.player.legend
                    ? "LEGEND"
                    : currentLot.player.nationality.toUpperCase()}
                </i>
              </a>
              <h2 className="auction-player-name">
                <a href={profileHref}>{currentLot.player.name}</a>
              </h2>
              <div className="player-tags">
                <span>{currentLot.player.role}</span>
                <span>
                  {currentLot.player.overseas ? "OVERSEAS" : "INDIAN"}
                </span>
                {currentLot.player.legend && (
                  <span className="legend-tag">IPL LEGEND</span>
                )}
                {preferredPositions(currentLot.player).length > 0 && (
                  <span className="preferred-position-tag">
                    PREFERRED BAT:{" "}
                    {formatPreferredPositions(
                      preferredPositions(currentLot.player),
                    )}
                  </span>
                )}
                <a
                  className="auction-profile-link"
                  href={profileHref}
                  aria-label={profileLabel}
                  title={profileLabel}
                />
              </div>
              {room.settings.showRatings && (
                <div className="ratings-strip">
                  <div className="ovr-rating">
                    <span>OVR</span>
                    <strong>{currentLot.player.ovr}</strong>
                  </div>
                  <div>
                    <span>BATTING</span>
                    <strong>{currentLot.player.batting}</strong>
                  </div>
                  <div>
                    <span>BOWLING</span>
                    <strong>{currentLot.player.bowling}</strong>
                  </div>
                  <div>
                    <span>FIELDING</span>
                    <strong>{currentLot.player.fielding}</strong>
                  </div>
                </div>
              )}
              <div className="base-price-line">
                <span>BASE PRICE</span>
                <strong>{money(currentLot.basePrice)}</strong>
              </div>
              <AuctionTimer
                lot={currentLot}
                paused={room.auctionPaused}
                bidSeconds={room.settings.bidSeconds}
              />
              <div className="bid-controls-row">
                <button
                  className={`button bid-button ${isMyBid ? "leading" : ""}`}
                  disabled={!canBidAt(1)}
                  onClick={() => placeBid(1)}
                >
                  {isMyOut ? (
                    "OUT FOR THIS PLAYER"
                  ) : isMyBid ? (
                    "YOU ARE THE HIGHEST BIDDER"
                  ) : legendLimitReached ? (
                    "LEGEND LIMIT REACHED"
                  ) : !canBidAt(1) ? (
                    me?.purse < nextBid(currentLot) ? (
                      "PURSE TOO LOW"
                    ) : (
                      "BID UNAVAILABLE"
                    )
                  ) : (
                    <>
                      BID {money(bidPriceFor(1))}
                      <span>↗</span>
                    </>
                  )}
                </button>
                {configuredMultipliers.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="button bid-multiplier-button"
                    disabled={!canBidAt(n)}
                    onClick={() => placeBid(n)}
                    title={
                      currentLot.currentBidderId
                        ? `Bid ${n} increments: ${money(bidPriceFor(n))}`
                        : `Opening bid: ${money(bidPriceFor(n))} (base plus ${n - 1} increments)`
                    }
                    aria-label={
                      currentLot.currentBidderId
                        ? `Bid ${n} increments: ${money(bidPriceFor(n))}`
                        : `Opening bid: ${money(bidPriceFor(n))} (base plus ${n - 1} increments)`
                    }
                  >
                    ×{n}
                  </button>
                ))}
              </div>
              <button
                className={`button out-button ${isMyOut ? "marked-out" : ""}`}
                disabled={!canMarkOut}
                title={
                  isMyOut
                    ? "You are already out for this player."
                    : isMyRtmArmed
                      ? "Your RTM is ON. Turn it OFF before opting out."
                      : isMyBid
                        ? "Highest bidder cannot opt out."
                        : room.auctionPaused
                          ? "Resume the auction to opt out."
                          : "Stop bidding for this player."
                }
                onClick={() =>
                  emitAction("auction:out", { lotId: currentLot.id })
                }
              >
                {isMyOut ? "YOU’RE OUT" : "I’M OUT"}
              </button>
              {room.settings.rtmEnabled && currentLot.rtmHolderUserId && (
                <div className={`rtm-panel ${rtmIsOnForMe ? "armed" : ""}`}>
                  {isMyRtmHolder ? (
                    <>
                      <button
                        type="button"
                        className={`rtm-toggle ${rtmIsOnForMe ? "active" : ""}`}
                        disabled={!appOnline || (!rtmIsOnForMe && !canArmRtm)}
                        aria-pressed={Boolean(rtmIsOnForMe)}
                        onClick={() =>
                          emitAction("auction:rtmToggle", {
                            lotId: currentLot.id,
                            enabled: !rtmIsOnForMe,
                          })
                        }
                      >
                        <span>
                          <strong>RIGHT TO MATCH</strong>
                          <small>
                            {rtmIsOnForMe
                              ? "Armed: match the final winning bid"
                              : isMyOut
                                ? "You are OUT for this player"
                                : "Secure this player at the final winning price"}
                          </small>
                        </span>
                        <i>{rtmIsOnForMe ? "ON" : "OFF"}</i>
                      </button>
                      <div className="rtm-footnote">
                        {myRtmRemaining} RTM{" "}
                        {myRtmRemaining === 1 ? "use" : "uses"} remaining ·
                        Toggle can be changed until this lot closes.
                        {isMyOut
                          ? " You have opted out and cannot activate RTM for this player."
                          : !canArmRtm && !rtmIsOnForMe
                            ? " Your purse or squad limits currently prevent matching this bid."
                            : ""}
                      </div>
                    </>
                  ) : (
                    <div className="rtm-public-status">
                      <strong>
                        {room.settings.rtmPublicStatus === false
                          ? `RTM OPTION · ${rtmHolder?.name || ""}`
                          : rtmIsOnForMe
                            ? `RTM ARMED · ${rtmHolder?.name || rtmHolder?.teamShort}`
                            : `RTM AVAILABLE · ${rtmHolder?.name || ""}`}
                      </strong>
                      <small>
                        {room.settings.rtmPublicStatus === false
                          ? `${rtmHolder?.name} holds the option. Activation is hidden until the lot closes.`
                          : rtmIsOnForMe
                            ? `${rtmHolder?.name} can match the final bid.`
                            : `${rtmHolder?.name} has the option to match the final bid.`}
                      </small>
                    </div>
                  )}
                </div>
              )}
              <div className="bid-hint">
                {isMyOut
                  ? "You are OUT for this player. You cannot bid or activate RTM again until the next lot."
                  : isMyRtmArmed
                    ? "Your Right to Match is ON. Turn it OFF before opting out."
                    : isMyBid
                      ? "You cannot opt out while you are the highest bidder."
                      : room.auctionPaused
                        ? "Bidding is paused by the host."
                        : currentLot.currentBidderId
                          ? "Every new bid resets the timer."
                          : "No bid? The player goes unsold when everyone opts out or the timer ends."}
              </div>
            </div>
          ) : (
            <div className="glass-card player-auction-card">
              <div className="loading-ring" />
              <h3>Preparing next player…</h3>
            </div>
          )}
          {notice && (
            <div className="notice-line">
              <span>◆</span>
              {notice}
            </div>
          )}
        </section>
        <aside className="auction-right-rail">
          <div className="glass-card bids-panel">
            <div className="panel-header">
              <div>
                <span className="section-kicker">IN THE ROOM</span>
                <h3>Teams bidding</h3>
              </div>
              <span className="small-count">{room.users.length}</span>
            </div>
            {room.users.map((u) => {
              const expanded = expandedBidderId === u.id && u.id !== meId;
              const bidderPlayers = [...(u.squad || [])].sort((a, b) => {
                const roleOrder = {
                  Batter: 0,
                  Wicketkeeper: 1,
                  "All-rounder": 2,
                  Bowler: 3,
                };
                return (
                  (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4) ||
                  a.name.localeCompare(b.name)
                );
              });
              return (
                <div className="bidder-entry" key={u.id}>
                  <div
                    className={`bidder-row ${u.id === currentLot?.currentBidderId ? "top-bidder" : ""}`}
                    style={{ "--team-color": u.teamColor }}
                  >
                    <button
                      type="button"
                      className={`bidder-row-main ${u.id === meId ? "self" : ""}`}
                      disabled={u.id === meId}
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedBidderId(expanded ? null : u.id)
                      }
                      title={
                        u.id === meId
                          ? "Your squad is shown on the left."
                          : `${expanded ? "Hide" : "View"} ${u.name}'s squad`
                      }
                    >
                      <TeamLogo
                        teamKey={u.teamShort}
                        short={u.teamShort}
                        className="bidder-crest"
                        title={u.teamName}
                      />
                      <div>
                        <div className="bidder-name-line">
                          <strong>
                            {u.name}
                            {u.id === meId ? " · YOU" : ""}
                          </strong>
                          <span
                            className={`bidder-state-chip ${!currentLot ? "idle" : u.id === currentLot.currentBidderId ? "leading" : currentLot.outUserIds?.includes(u.id) ? "out" : "in"}`}
                          >
                            {!currentLot
                              ? "WAIT"
                              : u.id === currentLot.currentBidderId
                                ? "LEADING"
                                : currentLot.outUserIds?.includes(u.id)
                                  ? "OUT"
                                  : "IN"}
                          </span>
                        </div>
                        <span>
                          {u.squadCount} players · {u.overseasCount}/8 overseas
                          · {u.legendCount || 0}/{legendLimitLabel} legends
                          {!u.connected ? " · OFFLINE" : ""}
                        </span>
                      </div>
                      <b>{money(u.purse)}</b>
                      {u.id !== meId && (
                        <span
                          className={`bidder-expand-chevron ${expanded ? "expanded" : ""}`}
                        >
                          ⌄
                        </span>
                      )}
                    </button>
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
                  {expanded && (
                    <div className="bidder-squad-preview">
                      <div className="bidder-preview-summary">
                        <span>{u.teamShort} SQUAD</span>
                        <b>
                          {u.squadCount}/25 · {u.legendCount || 0} legends ·{" "}
                          {u.overseasCount}/8 overseas
                        </b>
                      </div>
                      {bidderPlayers.length ? (
                        <div className="bidder-preview-list">
                          {bidderPlayers.map((player) => (
                            <div
                              className="bidder-preview-player"
                              key={player.id}
                            >
                              <span className="role-chip">
                                {roleShort[player.role]}
                              </span>
                              <div className="bidder-preview-player-info">
                                <strong>{player.name}</strong>
                                <small>
                                  {player.overseas ? "OVERSEAS" : "INDIAN"}
                                  {player.legend ? " · LEGEND" : ""}
                                </small>
                                <div className="bidder-preview-ratings">
                                  <span>
                                    OVR <b>{player.ovr ?? "—"}</b>
                                  </span>
                                  <span>
                                    BAT <b>{player.batting ?? "—"}</b>
                                  </span>
                                  <span>
                                    BOWL <b>{player.bowling ?? "—"}</b>
                                  </span>
                                  <span>
                                    FIELD <b>{player.fielding ?? "—"}</b>
                                  </span>
                                </div>
                              </div>
                              <b>
                                {player.retained
                                  ? "Retained"
                                  : money(player.purchasePrice)}
                              </b>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bidder-preview-empty">
                          No players in the squad yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="glass-card recent-panel">
            <div className="panel-header">
              <div>
                <span className="section-kicker">RECENT LOTS</span>
                <h3>Last sold</h3>
              </div>
              <span className="small-count">{room.sold.length}</span>
            </div>
            {room.lotHistory
              .slice(-5)
              .reverse()
              .map((lot) => (
                <div
                  className="recent-lot"
                  key={`${lot.lotNumber}-${lot.playerId}`}
                >
                  <div>
                    <strong>{lot.playerName}</strong>
                    <span>
                      {lot.teamName || "No bids"} · {lot.set}
                    </span>
                  </div>
                  <b className={lot.result === "UNSOLD" ? "unsold-price" : ""}>
                    {lot.price ? money(lot.price) : "UNSOLD"}
                  </b>
                </div>
              ))}
          </div>
          {isHost && (
            <div className="host-actions glass-card">
              <span className="section-kicker">HOST TOOLS</span>
              <div className="host-action-buttons">
                {room.auctionPaused ? (
                  <button
                    className="button small secondary"
                    onClick={() => hostAction("host:resumeAuction")}
                  >
                    ▶ Resume
                  </button>
                ) : (
                  <button
                    className="button small secondary"
                    onClick={() => hostAction("host:pauseAuction")}
                  >
                    Ⅱ Pause
                  </button>
                )}
                <button
                  className="button small danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        "End the auction now? The current high bid will be sold.",
                      )
                    )
                      hostAction("host:endAuction");
                  }}
                >
                  ■ End auction
                </button>
              </div>
              <p>You can stop now, or resume later from the squad review.</p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

import { SquadCard } from "../components/TeamCards";

export function ResultsScreen(props) {
  const {
    room,
    isHost,
    hostAction,
    allSquadsHaveXI,
    me,
    meId,
    tradeTarget,
    getTeam,
    emitAction,
    setTradeTarget,
    setTradeTheirPlayer,
    tradeOwnPlayer,
    setTradeOwnPlayer,
    roleShort,
    tradeTheirPlayer,
    DEFAULT_AUCTION_LEGEND_LIMIT,
    kickUser,
  } = props;
  const retainedCount = room.users.reduce(
    (sum, user) => sum + user.squad.filter((player) => player.retained).length,
    0,
  );
  return (
    <main className="wrap page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> AUCTION RESULTS
          </div>
          <h2>
            The squads are <em>taking shape.</em>
          </h2>
          <p>
            {room.sold.length} players sold ·{" "}
            {retainedCount > 0 && `${retainedCount} retained · `}
            {room.unsold.length} unsold · {room.users.length} franchises in this
            room.
          </p>
        </div>
        <div className="result-actions">
          {isHost && (room.lotsRemaining > 0 || room.unsold.length > 0) && (
            <button
              className="button secondary"
              onClick={() => hostAction("host:continueAuction")}
            >
              Continue auction ↗
            </button>
          )}
          {isHost && (
            <button
              className="button primary"
              disabled={!allSquadsHaveXI}
              title={
                !allSquadsHaveXI
                  ? "Each team needs a valid XI of 11, with at most 4 overseas players and 4 legends."
                  : ""
              }
              onClick={() => hostAction("host:startLineups")}
            >
              Choose starting XIs <span>→</span>
            </button>
          )}
        </div>
      </div>
      {!allSquadsHaveXI && (
        <div className="warning-banner">
          <span>!</span> Each team needs a valid combination of 11 players with
          no more than four overseas players and four legends. Resume the
          auction so teams can complete their squads.
        </div>
      )}
      {room.settings.tradesEnabled && (
        <section className="glass-card trade-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">PLAYER EXCHANGE</span>
              <h3>Trade with another franchise</h3>
            </div>
            <span className="trade-usage">
              {me?.tradesUsed || 0}/{room.settings.tradeLimit} trades used
            </span>
          </div>
          <p className="trade-explainer">
            Propose a one-for-one swap. The other manager must accept. Each
            completed swap counts toward both teams' limits. No purse changes.
          </p>
          {(() => {
            const pending = room.tradeOffers || [];
            const mine = pending.find(
              (offer) => offer.fromId === meId || offer.toId === meId,
            );
            const other = room.users.find((u) => u.id === tradeTarget);
            const available =
              !mine && (me?.tradesUsed || 0) < room.settings.tradeLimit;
            return (
              <>
                {mine && (
                  <div className="trade-pending">
                    <strong>
                      {mine.toId === meId
                        ? "INCOMING OFFER"
                        : "AWAITING RESPONSE"}
                    </strong>
                    <p>
                      {getTeam(room, mine.fromId)?.teamShort} offers{" "}
                      {getTeam(room, mine.fromId)?.squad?.find(
                        (p) => p.id === mine.myPlayerId,
                      )?.name || "a player"}{" "}
                      for{" "}
                      {getTeam(room, mine.toId)?.squad?.find(
                        (p) => p.id === mine.theirPlayerId,
                      )?.name || "a player"}{" "}
                      from {getTeam(room, mine.toId)?.teamShort}.
                    </p>
                    <div className="trade-actions">
                      {mine.toId === meId && (
                        <button
                          className="button primary small"
                          onClick={() =>
                            emitAction("trade:respond", {
                              offerId: mine.id,
                              accept: true,
                            })
                          }
                        >
                          Accept trade
                        </button>
                      )}
                      <button
                        className="button secondary small"
                        onClick={() =>
                          emitAction("trade:respond", {
                            offerId: mine.id,
                            accept: false,
                          })
                        }
                      >
                        {mine.toId === meId ? "Decline" : "Cancel offer"}
                      </button>
                    </div>
                  </div>
                )}
                {available && (
                  <div className="trade-form">
                    <label>
                      Trade with
                      <select
                        value={tradeTarget}
                        onChange={(e) => {
                          setTradeTarget(e.target.value);
                          setTradeTheirPlayer("");
                        }}
                      >
                        <option value="">Select franchise</option>
                        {room.users
                          .filter(
                            (u) =>
                              u.id !== meId &&
                              u.connected &&
                              (u.tradesUsed || 0) < room.settings.tradeLimit &&
                              !pending.some(
                                (o) => o.fromId === u.id || o.toId === u.id,
                              ),
                          )
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.teamShort} · {u.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      You give
                      <select
                        value={tradeOwnPlayer}
                        onChange={(e) => setTradeOwnPlayer(e.target.value)}
                      >
                        <option value="">Select your player</option>
                        {me?.squad?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {roleShort[p.role]} · OVR {p.ovr}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      You receive
                      <select
                        value={tradeTheirPlayer}
                        onChange={(e) => setTradeTheirPlayer(e.target.value)}
                      >
                        <option value="">Select their player</option>
                        {other?.squad?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {roleShort[p.role]} · OVR {p.ovr}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button primary small"
                      disabled={
                        !tradeTarget || !tradeOwnPlayer || !tradeTheirPlayer
                      }
                      onClick={() => {
                        emitAction("trade:propose", {
                          toUserId: tradeTarget,
                          myPlayerId: tradeOwnPlayer,
                          theirPlayerId: tradeTheirPlayer,
                        });
                        setTradeOwnPlayer("");
                        setTradeTheirPlayer("");
                      }}
                    >
                      Send trade offer
                    </button>
                  </div>
                )}
                {(me?.tradesUsed || 0) >= room.settings.tradeLimit && (
                  <p className="trade-explainer">
                    You've reached your trade limit.
                  </p>
                )}
              </>
            );
          })()}
          {(room.tradeHistory || []).length > 0 && (
            <div className="trade-history">
              {room.tradeHistory
                .slice(-4)
                .reverse()
                .map((t) => (
                  <p key={t.id}>
                    {t.fromTeam}: {t.fromPlayer} ↔ {t.toTeam}: {t.toPlayer}
                  </p>
                ))}
            </div>
          )}
        </section>
      )}
      <div className="teams-grid">
        {room.users.map((u) => (
          <SquadCard
            key={u.id}
            user={u}
            showRatings={room.settings.showRatings}
            startingPurse={room.settings.startingPurse}
            legendAuctionLimit={
              room.settings.legendAuctionLimit ?? DEFAULT_AUCTION_LEGEND_LIMIT
            }
            isMe={u.id === meId}
            isHost={isHost}
            onKick={kickUser}
          />
        ))}
      </div>
    </main>
  );
}

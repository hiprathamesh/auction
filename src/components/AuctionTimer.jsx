import { useEffect, useState } from "react";
import { money } from "../lib/format";

export function AuctionTimer({ lot, paused, bidSeconds }) {
  const [remaining, setRemaining] = useState(lot.timerRemainingMs || 0);
  useEffect(() => {
    const initial = Math.max(0, lot.timerRemainingMs || 0);
    const started = performance.now();
    const update = () =>
      setRemaining(
        Math.max(0, initial - (paused ? 0 : performance.now() - started)),
      );
    update();
    if (paused) return undefined;
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [lot.id, lot.endsAt, lot.timerRemainingMs, paused]);
  return (
    <>
      <div className="bid-price-line">
        <div>
          <span>
            {lot.currentBidderId ? "CURRENT BID" : "FIRST BID AT BASE PRICE"}
          </span>
          <strong>
            {money(lot.currentBidderId ? lot.currentBid : lot.basePrice)}
          </strong>
          {lot.currentBidderName && <small>by {lot.currentBidderName}</small>}
        </div>
        <div className={`timer-orb ${paused ? "paused" : ""}`}>
          <strong>{paused ? "Ⅱ" : Math.ceil(remaining / 1000)}</strong>
          <span>{paused ? "PAUSED" : "SECONDS"}</span>
        </div>
      </div>
      <div className="bid-timer-track">
        <i
          style={{
            width: `${Math.max(0, Math.min(100, (remaining / (bidSeconds * 1000)) * 100))}%`,
          }}
        />
      </div>
    </>
  );
}

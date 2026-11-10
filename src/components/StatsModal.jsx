import { useEffect, useRef } from "react";

export function StatsModal({ room, tab, setTab, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [
      ...dialog.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    focusable()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === items[items.length - 1]
      ) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, []);
  const tabs = [
    ["orangeCap", "Orange cap"],
    ["purpleCap", "Purple cap"],
    ["mvp", "MVP"],
    ["more", "More stats"],
  ];
  const leaders = room.playerLeaders || {};
  const keyFor = { orangeCap: "orangeCap", purpleCap: "purpleCap", mvp: "mvp" };
  const isMore = tab === "more";
  const singleRows = !isMore ? leaders[keyFor[tab]] || [] : [];
  const tables = isMore
    ? [
        ["Most sixes", leaders.mostSixes || [], "sixes", "SIX"],
        ["Most fours", leaders.mostFours || [], "fours", "FOUR"],
        [
          "Best strike rate · min 12 balls",
          leaders.bestStrikeRate || [],
          "strikeRate",
          "SR",
        ],
        [
          "Best economy · min 2 overs",
          leaders.bestEconomy || [],
          "economy",
          "ECON",
        ],
        [
          "Best bowling figures",
          leaders.bestFigures || [],
          "bestBowling",
          "FIG",
        ],
        ["Most 50s", leaders.mostFifties || [], "fifties", "50s"],
        ["Most 100s", leaders.mostHundreds || [], "hundreds", "100s"],
      ]
    : [];
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        className="stats-modal glass-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-title"
      >
        <div className="modal-header">
          <div>
            <span className="section-kicker">TOURNAMENT ANALYTICS</span>
            <h2 id="stats-title">
              Leaderboards & <em>records.</em>
            </h2>
          </div>
          <button
            className="modal-close"
            aria-label="Close statistics"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-tabs">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {!isMore ? (
            <div className="leaderboard-list">
              {singleRows.length ? (
                singleRows.map((p, index) => (
                  <div className="leaderboard-row" key={p.playerId || p.name}>
                    <span className="leaderboard-rank">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="leaderboard-player">
                      <strong>{p.name}</strong>
                      <span>{p.teamName || p.teamId || "—"}</span>
                    </div>
                    <strong className="leaderboard-value">
                      {tab === "orangeCap"
                        ? p.runs
                        : tab === "purpleCap"
                          ? p.wickets
                          : Math.round(p.mvpScore || 0)}
                      <small>
                        {tab === "orangeCap"
                          ? "RUNS"
                          : tab === "purpleCap"
                            ? "WKT"
                            : "MVP PTS"}
                      </small>
                    </strong>
                  </div>
                ))
              ) : (
                <div className="modal-empty">
                  No tournament records yet. They will build as matches finish.
                </div>
              )}
            </div>
          ) : (
            <div className="stats-tables">
              {tables.map(([title, rows, field, label]) => (
                <section className="stats-table-block" key={title}>
                  <h3>{title}</h3>
                  {rows.length ? (
                    rows.map((p, i) => (
                      <div
                        className="stats-mini-row"
                        key={`${title}-${p.playerId || p.name}`}
                      >
                        <span>{i + 1}</span>
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.teamName || p.teamId || "—"}</small>
                        </div>
                        <b>
                          {field === "strikeRate" || field === "economy"
                            ? Number(p[field] || 0).toFixed(2)
                            : p[field] || 0}
                          <small>{label}</small>
                        </b>
                      </div>
                    ))
                  ) : (
                    <p className="muted mini-empty">No data yet.</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span>Stats update after every completed match.</span>
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

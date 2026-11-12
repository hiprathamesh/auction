import { useState } from "react";
import metrics from "../../shared/career-metrics.json";
import {
  Empty,
  Panel,
  Table,
  money,
  number,
  playerPath,
  useData,
} from "./HubLayout";

export { metrics };
export const overs = (balls = 0) => `${Math.floor(balls / 6)}.${balls % 6}`;

export function metricValue(row, key, scope = "career") {
  const metric = metrics[key];
  if (metric?.sample && (row[metric.sample] || 0) < metric[scope]) return null;
  if (metric?.bottom)
    return row[metric.bottom] > 0
      ? ((row[metric.top] || 0) * (metric.scale || 1)) / row[metric.bottom]
      : null;
  return row[key] ?? 0;
}

export function formatMetric(key, value) {
  if (value == null) return "—";
  if (key === "averagePrice") return money(value);
  if (metrics[key]?.bottom) return value.toFixed(2);
  return number(Math.round(value));
}

export function qualification(key, scope = "career") {
  const metric = metrics[key];
  if (!metric?.sample) return "";
  const minimum = metric[scope] / (metric.sample === "bowlerBalls" ? 6 : 1);
  const needsWicket = metric.bottom === "wickets";
  const needsDismissal = metric.bottom === "outs";
  return `Minimum ${minimum} ${metric.unit}${needsWicket ? " and one wicket" : needsDismissal ? " and one dismissal" : ""}.`;
}

export function rankedRows(players, key, scope = "career") {
  const descending = metrics[key]?.low ? -1 : 1;
  const rows = players
    .map((row) => ({ ...row, value: metricValue(row, key, scope) }))
    .filter(
      (row) => row.value !== null && (metrics[key]?.bottom || row.value > 0),
    )
    .sort(
      (a, b) =>
        descending * (b.value - a.value) || a.name.localeCompare(b.name),
    );
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || row.value !== rows[index - 1].value) rank = index + 1;
    return { ...row, rank };
  });
}

export function CareerBoards() {
  const state = useData("/api/players");
  const [group, setGroup] = useState("Batting");
  if (state.error)
    return (
      <p className="archive-note" role="alert">
        {state.error}
      </p>
    );
  if (!state.data) return <Empty>Loading career leaders…</Empty>;
  return (
    <div className="hub-stack">
      <div className="archive-filters" aria-label="Career leaderboard category">
        {["Batting", "Bowling", "MVP", "Auction"].map((label) => (
          <button
            key={label}
            type="button"
            className={group === label ? "active" : ""}
            aria-pressed={group === label}
            onClick={() => setGroup(label)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="archive-overview-grid hub-overview">
        {Object.entries(metrics)
          .filter(([, metric]) => metric.group === group)
          .map(([key, metric]) => {
            const rows = rankedRows(state.data.players, key).slice(0, 6);
            return (
              <Panel key={key} title={metric.label}>
                {qualification(key) && (
                  <p className="archive-note">{qualification(key)}</p>
                )}
                {rows.length ? (
                  <Table
                    label={metric.label + " leaders"}
                    rows={rows}
                    columns={[
                      ["Rank", (row) => row.rank],
                      [
                        "Player",
                        (row) => (
                          <a
                            className="hub-data-link"
                            href={playerPath(row.id)}
                          >
                            {row.name}
                          </a>
                        ),
                      ],
                      [metric.label, (row) => formatMetric(key, row.value)],
                      ...(group === "Bowling"
                        ? [["Overs", (row) => overs(row.bowlerBalls)]]
                        : group === "Batting"
                          ? [["Balls", (row) => number(row.balls)]]
                          : group === "Auction"
                            ? [["Sales", (row) => number(row.auctionSales)]]
                            : []),
                    ]}
                  />
                ) : (
                  <Empty>No qualifying players yet.</Empty>
                )}
              </Panel>
            );
          })}
      </div>
    </div>
  );
}

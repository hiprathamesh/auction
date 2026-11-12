import { useId } from "react";

export function ScoreProgression({ innings, deliveries }) {
  const title = useId();
  const series = innings
    .map((score, index) => ({
      name: score.battingTeamName,
      balls: score.legalBalls,
      runs: score.runs,
      events: deliveries[index] || [],
    }))
    .filter((entry) => entry.events.length);
  if (!series.length)
    return (
      <p className="archive-note">
        Delivery history is unavailable for this match.
      </p>
    );
  const target = innings[1]?.target;
  const maxBalls = Math.max(6, ...series.map((entry) => entry.balls));
  const maxRuns = Math.max(
    25,
    Math.ceil(
      Math.max(target || 0, ...series.map((entry) => entry.runs)) / 25,
    ) * 25,
  );
  const x = (balls) => 38 + (balls / maxBalls) * 482;
  const y = (runs) => 166 - (runs / maxRuns) * 139;
  const colors = ["#ffab79", "#69c9e3"];
  return (
    <figure className="archive-progression">
      <figcaption id={title}>Score progression</figcaption>
      <svg viewBox="0 0 542 198" role="img" aria-labelledby={title}>
        {[0, 1, 2, 3, 4].map((step) => {
          const runs = Math.round((maxRuns * step) / 4);
          return (
            <g key={step} className="archive-chart-grid">
              <line x1={x(0)} x2={x(maxBalls)} y1={y(runs)} y2={y(runs)} />
              <text x={x(0) - 7} y={y(runs) + 4} textAnchor="end">
                {runs}
              </text>
            </g>
          );
        })}
        {[0, 5, 10, 15, 20]
          .filter((over) => over * 6 <= maxBalls)
          .map((over) => (
            <text key={over} x={x(over * 6)} y="186" textAnchor="middle">
              {over} ov
            </text>
          ))}
        {target > 0 && (
          <line
            className="archive-chart-target"
            x1={x(0)}
            x2={x(maxBalls)}
            y1={y(target)}
            y2={y(target)}
          />
        )}
        {series.map((entry, index) => (
          <g key={entry.name} stroke={colors[index]}>
            <polyline
              fill="none"
              strokeWidth="2"
              points={[
                [x(0), y(0)],
                ...entry.events.map((ball) => [x(ball.balls), y(ball.score)]),
              ]
                .map((point) => point.join(","))
                .join(" ")}
            />
            {entry.events
              .filter((ball) => ball.wicket)
              .map((ball) => (
                <circle
                  key={ball.key || ball.overs}
                  cx={x(ball.balls)}
                  cy={y(ball.score)}
                  r="3.5"
                  fill="#111922"
                  strokeWidth="1.5"
                >
                  <title>{`${entry.name} · ${ball.overs} overs · ${ball.score}/${ball.wickets}`}</title>
                </circle>
              ))}
          </g>
        ))}
      </svg>
      <ul className="archive-chart-legend">
        {series.map((entry, index) => (
          <li key={entry.name}>
            <i style={{ background: colors[index] }} /> {entry.name}
          </li>
        ))}
        {target > 0 && (
          <li>
            <i className="archive-target-key" /> Target {target}
          </li>
        )}
        <li>
          <i className="archive-wicket-key" /> Wicket
        </li>
      </ul>
    </figure>
  );
}

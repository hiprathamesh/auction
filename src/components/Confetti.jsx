import { useMemo } from "react";

export function Confetti({ kind, token }) {
  const pieces = useMemo(
    () =>
      Array.from(
        { length: kind === "win" ? 90 : kind === "wicket" ? 28 : 36 },
        (_, i) => ({
          id: `${token}-${i}`,
          x: `${Math.random() * 100}%`,
          delay: `${Math.random() * 0.3}s`,
          duration: `${0.75 + Math.random() * 1.5}s`,
          rotate: `${Math.random() * 720 - 360}deg`,
          size: `${4 + Math.random() * 7}px`,
          hue:
            kind === "wicket"
              ? Math.round(Math.random() * 12)
              : Math.round(Math.random() * 360),
        }),
      ),
    [kind, token],
  );
  return (
    <div className={`confetti-layer ${kind}`} key={token} aria-hidden="true">
      {pieces.map((p) => (
        <i
          key={p.id}
          style={{
            "--x": p.x,
            "--delay": p.delay,
            "--duration": p.duration,
            "--rotate": p.rotate,
            "--size": p.size,
            "--hue": p.hue,
          }}
        />
      ))}
    </div>
  );
}

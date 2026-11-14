import { memo, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

const PIECE_COUNTS = { four: 24, six: 36, wicket: 28, milestone: 36, win: 90 };
const PALETTES = {
  four: [29, 46, 173],
  six: [36, 190, 272],
  wicket: [0, 12, 345],
};

export const Confetti = memo(function Confetti({ id, kind, onFinish }) {
  const pieces = useMemo(() => {
    const palette = PALETTES[kind];
    return Array.from({ length: PIECE_COUNTS[kind] }, (_, index) => ({
      id: index,
      x: `${Math.random() * 100}%`,
      delay: `${index % 8 === 0 ? 0 : Math.random() * 0.14}s`,
      duration: `${(kind === "win" ? 1.15 : 0.58) + Math.random() * 0.55}s`,
      rotate: `${Math.random() * 720 - 360}deg`,
      size: `${4 + Math.random() * 6}px`,
      hue: palette
        ? palette[index % palette.length]
        : Math.floor(Math.random() * 360),
    }));
  }, [kind]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => onFinish(id),
      kind === "win" ? 1900 : 1300,
    );
    return () => window.clearTimeout(timer);
  }, [id, kind, onFinish]);

  return createPortal(
    <div className={`confetti-layer ${kind}`} aria-hidden="true">
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
    </div>,
    document.body,
  );
});

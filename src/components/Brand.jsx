import { useState } from "react";
import "./brand.css";

export function ArenaBrand({ onClick }) {
  const Element = onClick ? "button" : "a";
  return (
    <Element
      className="brand"
      {...(onClick ? { type: "button", onClick } : { href: "/" })}
    >
      <IplBrandLogo />
      <span>
        <span className="brand-name">
          AUCTION<span>ARENA</span>
        </span>
        <span className="brand-sub">IPL · DRAFT YOUR DYNASTY</span>
      </span>
    </Element>
  );
}

const teamLogoFile = (teamKey) =>
  String(teamKey || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function TeamLogo({ teamKey, short, className = "", title }) {
  const [format, setFormat] = useState("avif");
  const [failed, setFailed] = useState(false);
  const file = teamLogoFile(teamKey || short);
  if (failed || !file)
    return (
      <span className={className} title={title || short}>
        {short || teamKey || "?"}
      </span>
    );
  return (
    <span
      className={`${className} logo-image-wrap`}
      title={title || short}
      aria-label={title || short}
    >
      <img
        src={`/logos/${file}.${format}`}
        alt={title || short || "IPL team"}
        onError={() => {
          if (format === "avif") setFormat("webp");
          else setFailed(true);
        }}
      />
    </span>
  );
}
export function IplBrandLogo() {
  const [format, setFormat] = useState("avif");
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span className="brand-mark brand-mark-fallback">
        <span>IP</span>
        <span>L</span>
      </span>
    );
  return (
    <span className="brand-mark brand-mark-image">
      <img
        src={`/logos/ipl.${format}`}
        alt="IPL"
        onError={() => {
          if (format === "avif") setFormat("webp");
          else setFailed(true);
        }}
      />
    </span>
  );
}

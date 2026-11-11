import { useEffect, useState } from "react";
import { ArenaBrand } from "../components/Brand";
import "../archive/season.css";
import "./hub.css";

export const date = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export const number = (value) => Number(value || 0).toLocaleString();
export const seasonCode = (id) => "S" + String(id).padStart(2, "0");
export const money = (value) =>
  value == null
    ? "—"
    : "₹" + Number(value).toFixed(2).replace(/\.00$/, "") + " Cr";
export const rate = (top, bottom, scale = 1, digits = 1) =>
  bottom ? ((top * scale) / bottom).toFixed(digits) : "—";
export const playerPath = (id) => "/p/" + encodeURIComponent(id);

export function Shell({ section = "hub", children }) {
  return (
    <>
      <header className="archive-top hub-top">
        <ArenaBrand />
        <nav aria-label="Arena navigation">
          <a
            href="/s"
            aria-current={section === "hub" ? "location" : undefined}
          >
            Hub
          </a>
          <a
            href="/p"
            aria-current={section === "players" ? "location" : undefined}
          >
            Players
          </a>
          <a href="/">Play ↗</a>
        </nav>
      </header>
      <main className="archive-wrap hub-wrap">{children}</main>
    </>
  );
}

export function useData(url) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          setState({
            error: result.error || "This page is unavailable.",
            signIn: response.status === 401,
          });
          return;
        }
        setState({ data: result });
      })
      .catch((error) => {
        if (error.name !== "AbortError")
          setState({ error: "Could not load this page. Try refreshing." });
      });
    return () => controller.abort();
  }, [url]);
  return state;
}

export function Status({ state, section }) {
  return (
    <Shell section={section}>
      <section className="archive-panel hub-status">
        <h1>
          {state.loading
            ? "Loading…"
            : state.signIn
              ? "Sign in to the Arena"
              : "Page unavailable"}
        </h1>
        {!state.loading && (
          <>
            <p>{state.error}</p>
            <a className="hub-link" href={state.signIn ? "/?identity=1" : "/s"}>
              {state.signIn ? "Open Identity ↗" : "Back to Hub ↗"}
            </a>
          </>
        )}
      </section>
    </Shell>
  );
}

export function Masthead({ label, title, subtitle, children, art }) {
  return (
    <section className="season-hero hub-masthead">
      <div className="hub-masthead-copy">
        <div className="archive-kicker">
          <span />
          {label}
        </div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {children}
      </div>
      {art}
    </section>
  );
}

export function Tabs({ label, tabs, active, onChange, children }) {
  function navigate(event, index) {
    const offsets = { ArrowRight: 1, ArrowLeft: -1 };
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key in offsets
            ? (index + offsets[event.key] + tabs.length) % tabs.length
            : null;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next]);
    event.currentTarget.parentElement.children[next].focus();
  }
  return (
    <>
      <div className="archive-tabs hub-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab}
            id={"tab-" + index}
            type="button"
            role="tab"
            aria-selected={tab === active}
            aria-controls="hub-tab-panel"
            tabIndex={tab === active ? 0 : -1}
            className={tab === active ? "active" : ""}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => navigate(event, index)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div
        className="hub-content"
        id="hub-tab-panel"
        role="tabpanel"
        aria-labelledby={"tab-" + tabs.indexOf(active)}
      >
        {children}
      </div>
    </>
  );
}

export function Panel({ title, kicker, aside, children }) {
  return (
    <section className="archive-panel hub-panel">
      <div className="panel-title">
        <div>
          {kicker && <small>{kicker}</small>}
          <h2>
            {title}
            <span>.</span>
          </h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Table({ label, columns, rows, rowKey = "id" }) {
  return (
    <div
      className="archive-table-scroll hub-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="archive-table hub-table">
        <thead>
          <tr>
            {columns.map(([heading]) => (
              <th scope="col" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row[rowKey]}>
              {columns.map(([heading, render], column) =>
                column === 0 ? (
                  <th key={heading} scope="row">
                    {render(row, index)}
                  </th>
                ) : (
                  <td key={heading}>{render(row, index)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Ledger({ entries }) {
  return (
    <dl className="hub-ledger">
      {entries.map(([label, value, swatch]) => (
        <div key={label}>
          <dt>
            {swatch && (
              <i className={"hub-swatch " + swatch} aria-hidden="true" />
            )}
            {label}
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }) {
  return <p className="hub-empty-state">{children}</p>;
}

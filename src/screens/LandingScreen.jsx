import { TeamLogo } from "../components/Brand";

export function LandingScreen(props) {
  const {
    playerCount,
    view,
    setView,
    displayName,
    setDisplayName,
    createRoom,
    joinRoom,
    roomCode,
    setRoomCode,
    recoveryInput,
    setRecoveryInput,
    initialTeams,
    teamId,
    setTeamId,
    error,
    appOnline,
    recoverHost,
  } = props;
  return (
    <main className="landing wrap">
      <section className="hero-copy">
        <a className="archive-landing-link" href="/seasons">
          ↗ Explore past seasons
        </a>
        <div className="eyebrow">
          <span className="eyebrow-line" /> YOUR FRIEND GROUP. YOUR AUCTION.
        </div>
        <h1>
          Build a squad.
          <br />
          <em>Own the league.</em>
        </h1>
        <p>
          Run your own IPL auction room, battle for the best players, then watch
          your XI go head-to-head in a fast, live tournament simulation.
        </p>
        <div className="hero-facts">
          <div>
            <strong>10</strong>
            <span>franchises</span>
          </div>
          <div>
            <strong>{playerCount ?? "—"}</strong>
            <span>players incl. legends</span>
          </div>
          <div>
            <strong>1</strong>
            <span>hosted room</span>
          </div>
        </div>
        <div className="hero-footnote">
          <span className="live-dot" /> PRIVATE ROOM · NO BOTS · UP TO 10
          FRIENDS
        </div>
      </section>
      <section className="join-card glass-card">
        <div className="card-topline">
          <span>GET IN THE GAME</span>
          <span className="card-step">01 / 03</span>
        </div>
        <div className="mode-tabs">
          <button
            className={view === "create" ? "active" : ""}
            onClick={() => setView("create")}
          >
            Create room
          </button>
          <button
            className={view === "join" ? "active" : ""}
            onClick={() => setView("join")}
          >
            Join a room
          </button>
          <button
            className={view === "recover" ? "active" : ""}
            onClick={() => setView("recover")}
          >
            Recover host
          </button>
        </div>
        {view !== "recover" && (
          <>
            <label className="field-label" htmlFor="display-name">
              YOUR DISPLAY NAME
            </label>
            <input
              id="display-name"
              className="text-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={22}
              placeholder="What should friends call you?"
              onKeyDown={(e) =>
                e.key === "Enter" &&
                (view === "create" ? createRoom() : joinRoom())
              }
            />
          </>
        )}
        {view !== "create" && (
          <>
            <label className="field-label" htmlFor="room-code-input">
              ROOM CODE
            </label>
            <input
              id="room-code-input"
              className="text-input code-input"
              value={roomCode}
              onChange={(e) =>
                setRoomCode(e.target.value.toUpperCase().slice(0, 5))
              }
              maxLength={5}
              placeholder="ABCDE"
            />
          </>
        )}
        {view === "recover" ? (
          <>
            <label className="field-label" htmlFor="recovery-code-input">
              HOST RECOVERY CODE
            </label>
            <input
              id="recovery-code-input"
              className="text-input"
              type="password"
              autoComplete="off"
              value={recoveryInput}
              onChange={(event) => setRecoveryInput(event.target.value)}
              placeholder="Paste your saved recovery code"
            />
          </>
        ) : (
          <>
            <label className="field-label">CHOOSE YOUR FRANCHISE</label>
            <div className="team-picker">
              {initialTeams.map((t) => (
                <button
                  key={t.id}
                  className={`team-tile ${teamId === t.id ? "selected" : ""}`}
                  onClick={() => setTeamId(t.id)}
                  style={{ "--team-color": t.color }}
                  title={t.name}
                >
                  <TeamLogo
                    teamKey={t.id}
                    short={t.short}
                    className="team-crest"
                    title={t.name}
                  />
                  <span>{t.name}</span>
                  <i />
                </button>
              ))}
            </div>
          </>
        )}
        {error && (
          <div className="error-banner">
            <span>!</span>
            {error}
          </div>
        )}
        <button
          className="button primary full-button"
          disabled={
            !appOnline ||
            (view === "recover"
              ? !recoveryInput.trim() || roomCode.trim().length < 5
              : !displayName.trim() ||
                (view === "join" && roomCode.trim().length < 5))
          }
          onClick={
            view === "create"
              ? createRoom
              : view === "recover"
                ? recoverHost
                : joinRoom
          }
        >
          {view === "create"
            ? "Create private room"
            : view === "recover"
              ? "Recover host seat"
              : "Join auction room"}{" "}
          <span>↗</span>
        </button>
        <div className="secure-note">
          <span>◇</span> Hosted on your machine. Share your tunnel link with
          friends.
        </div>
      </section>
    </main>
  );
}

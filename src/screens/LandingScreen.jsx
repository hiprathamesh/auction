import { useState } from "react";
import { TeamLogo } from "../components/Brand";
import { PinField } from "../components/PinField";
import { socket } from "../socket";

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
    identity,
    setIdentity,
    clearError,
  } = props;
  const [identityInput, setIdentityInput] = useState("");
  const [pin, setPin] = useState("");
  const [identityError, setIdentityError] = useState("");
  const [identityBusy, setIdentityBusy] = useState(false);
  const [changingPin, setChangingPin] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinChanged, setPinChanged] = useState(false);
  const canIdentify =
    /^[a-z][a-z0-9]{3,31}$/.test(identityInput) &&
    pin.length === 4 &&
    !identityBusy;
  const canChangePin =
    currentPin.length === 4 && newPin.length === 4 && !identityBusy;
  const identify = async (event) => {
    event.preventDefault();
    if (!canIdentify) return;
    setIdentityBusy(true);
    setIdentityError("");
    try {
      const response = await fetch("/api/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: identityInput, pin }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not identify you.");
      setIdentity(result.id);
      setPin("");
      clearError();
      socket.disconnect().connect();
    } catch (failure) {
      setIdentityError(failure.message);
    } finally {
      setIdentityBusy(false);
    }
  };
  const closePinForm = () => {
    setChangingPin(false);
    setCurrentPin("");
    setNewPin("");
    setIdentityError("");
  };
  const changePin = async (event) => {
    event.preventDefault();
    if (!canChangePin) return;
    setIdentityBusy(true);
    setIdentityError("");
    try {
      const response = await fetch("/api/identity/pin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ currentPin, newPin }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not change your PIN.");
      closePinForm();
      setPinChanged(true);
    } catch (failure) {
      setIdentityError(failure.message);
    } finally {
      setIdentityBusy(false);
    }
  };
  const signOut = async () => {
    setIdentityBusy(true);
    setIdentityError("");
    try {
      const response = await fetch("/api/identity", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Could not sign out.");
      setIdentity(null);
      closePinForm();
      setPinChanged(false);
      socket.disconnect().connect();
    } catch (failure) {
      setIdentityError(failure.message);
    } finally {
      setIdentityBusy(false);
    }
  };
  return (
    <main className="landing wrap">
      <section className="hero-copy">
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
          <span className="card-step">01 / 04</span>
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
          <button
            className={view === "identity" ? "active" : ""}
            onClick={() => setView("identity")}
          >
            Identity
          </button>
        </div>
        {view === "identity" ? (
          <div className="identity-panel">
            {identity ? (
              <>
                <p className="room-identity">
                  You are playing as <a href={`/u/${identity}`}>{identity}</a>.
                </p>
                <p>
                  Your ID follows you across seasons. Your PIN stays on this
                  server; this browser keeps a private session cookie.
                </p>
                {changingPin ? (
                  <form className="identity-form" onSubmit={changePin}>
                    <PinField
                      label="CURRENT PIN"
                      value={currentPin}
                      onChange={setCurrentPin}
                      autoComplete="current-password"
                      disabled={identityBusy}
                      autoFocus
                    />
                    <PinField
                      label="NEW PIN"
                      value={newPin}
                      onChange={setNewPin}
                      autoComplete="new-password"
                      disabled={identityBusy}
                    />
                    <div className="identity-actions">
                      <button
                        className="button ghost"
                        type="button"
                        disabled={identityBusy}
                        onClick={closePinForm}
                      >
                        Cancel
                      </button>
                      <button
                        className="button primary"
                        disabled={!canChangePin}
                      >
                        Confirm
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    className="button secondary full-button"
                    disabled={identityBusy}
                    onClick={() => {
                      setIdentityError("");
                      setPinChanged(false);
                      setChangingPin(true);
                    }}
                  >
                    Change PIN
                  </button>
                )}
                <button
                  className="button secondary full-button"
                  disabled={identityBusy}
                  onClick={signOut}
                >
                  Sign out
                </button>
                {pinChanged && <p role="status">Your PIN has been changed.</p>}
              </>
            ) : (
              <form className="identity-form" onSubmit={identify}>
                <p>
                  Choose a unique ID and a four-digit PIN. Use the same pair
                  next time to return to your profile.
                </p>
                <label className="field-label" htmlFor="identity-id">
                  YOUR ID
                </label>
                <input
                  id="identity-id"
                  className="text-input"
                  autoComplete="username"
                  disabled={identityBusy}
                  value={identityInput}
                  onChange={(e) =>
                    setIdentityInput(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, "")
                        .slice(0, 32),
                    )
                  }
                  placeholder="e.g. cricketfan7"
                />
                <small>
                  4–32 lowercase letters and digits; start with a letter.
                </small>
                <PinField
                  label="FOUR-DIGIT PIN"
                  autoComplete="current-password"
                  value={pin}
                  onChange={setPin}
                  disabled={identityBusy}
                />
                <button
                  className="button primary full-button"
                  disabled={!canIdentify}
                >
                  {identityBusy ? "Please wait…" : "Identify me ↗"}
                </button>
              </form>
            )}
            {(identityError || error) && (
              <p className="error-banner" role="alert">
                {identityError || error}
              </p>
            )}
          </div>
        ) : (
          <>
            {view !== "recover" && (
              <>
                {identity && (
                  <p className="room-identity">
                    {view === "create" ? "Creating" : "Joining"} as{" "}
                    <a href={`/u/${identity}`}>{identity}</a>
                  </p>
                )}
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
              <span>◇</span> Private room · Share the room link with friends.
            </div>
          </>
        )}
      </section>
    </main>
  );
}

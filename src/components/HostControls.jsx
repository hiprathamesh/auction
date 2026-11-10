import { useState } from "react";
import { socket } from "../socket";

export function HostControls({ room, recoveryToken, online }) {
  const [target, setTarget] = useState("");
  const [copied, setCopied] = useState(false);
  const copyRecovery = async () => {
    try {
      await navigator.clipboard.writeText(recoveryToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="wrap host-controls">
      <details>
        <summary>Host recovery and transfer</summary>
        <p>
          Save this private recovery code somewhere safe. Anyone with it and the
          room code can reclaim this host seat.
        </p>
        {recoveryToken ? (
          <div className="recovery-code">
            <code>{recoveryToken}</code>
            <button className="button small secondary" onClick={copyRecovery}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <p>No recovery code is saved in this browser. Generate a new one.</p>
        )}
        <button
          className="button small ghost"
          disabled={!online}
          onClick={() => socket.emit("host:rotateRecovery")}
        >
          Generate new recovery code
        </button>
        {room.users.some(
          (user) => user.id !== room.hostId && user.connected,
        ) && (
          <div className="host-transfer">
            <label htmlFor="host-transfer-target">Transfer host to</label>
            <select
              id="host-transfer-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">Choose a connected player</option>
              {room.users
                .filter((user) => user.id !== room.hostId && user.connected)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.teamShort}
                  </option>
                ))}
            </select>
            <button
              className="button small secondary"
              disabled={!online || !target}
              onClick={() => {
                if (window.confirm("Transfer host control to this player?"))
                  socket.emit("host:transfer", { userId: target });
              }}
            >
              Transfer
            </button>
          </div>
        )}
      </details>
    </div>
  );
}

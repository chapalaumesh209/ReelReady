"use client";
import { useState } from "react";
import { Check, Link2, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "./confirm-dialog";
import {
  platforms,
  platformNames,
  type Connections,
  type Platform,
} from "@/lib/workflow";

/** Account authorization belongs to the publish task; callbacks resume this reel. */
export function InlineAccounts({
  state,
  loaded,
  selected,
  locked,
  reelId,
  onSelect,
  refresh,
  beforeConnect,
}: {
  state: Connections;
  loaded: boolean;
  selected: Platform[];
  locked: boolean;
  reelId: string;
  onSelect: (platform: Platform) => void;
  refresh: () => Promise<void>;
  beforeConnect: () => Promise<void>;
}) {
  const accountNames = { instagram: "Instagram", youtube: "YouTube", x: "X" };
  const [busy, setBusy] = useState<Platform | "refresh" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [remove, setRemove] = useState<Platform | null>(null);
  async function act(platform: Platform, disconnect = false) {
    if (busy) return;
    setBusy(platform);
    setError("");
    setNotice("");
    try {
      if (!disconnect) {
        // Flush the active draft before official consent temporarily leaves this page.
        await beforeConnect();
        try {
          sessionStorage.setItem("reelready.return", `/?id=${reelId}`);
        } catch {
          /* Local draft still survives consent. */
        }
      }
      const response = await fetch(
        disconnect ? "/api/connect/disconnect" : `/api/connect/${platform}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform }),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        url?: string;
        revoked?: boolean;
      };
      if (!response.ok)
        throw new Error(result.error || "Couldn’t connect. Please try again.");
      if (!disconnect) {
        if (!result.url)
          throw new Error("Authorization did not start. Choose Connect again.");
        location.assign(result.url);
        return;
      }
      await refresh();
      setNotice(
        result.revoked === false
          ? "Disconnected here. Remove the remaining permission in your social account’s connected-app settings."
          : "Account disconnected.",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Please try connecting again.",
      );
    } finally {
      setBusy("");
      setRemove(null);
    }
  }
  return (
    <section className="inline-accounts" aria-labelledby="destinations-heading">
      <div className="section-heading">
        <h3 id="destinations-heading">Where should it go?</h3>
        <button
          className="quiet"
          aria-label="Refresh connections"
          disabled={!!busy}
          onClick={async () => {
            setBusy("refresh");
            setError("");
            try {
              await refresh();
            } finally {
              setBusy("");
            }
          }}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message notice" role="status">
          {notice}
        </p>
      )}
      {state.issue && (
        <p className="message warning" role="status">
          {state.issue}
        </p>
      )}
      <div className="account-list">
        {platforms.map((platform) => {
          const account = state.accounts[platform];
          const connected = account?.connected === true;
          return (
            <div className="account-row" key={platform}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(platform)}
                  disabled={locked || !!busy}
                  onChange={() => onSelect(platform)}
                />
                <strong>{platformNames[platform]}</strong>
              </label>
              <span className={connected ? "connected" : "hint"}>
                {!loaded ? (
                  "Checking…"
                ) : connected ? (
                  <>
                    <Check size={14} /> {account.name || "Connected"}
                  </>
                ) : account?.reauth ? (
                  "Reconnect needed"
                ) : account?.unavailable ? (
                  "Connection needs attention"
                ) : account?.configured === false ? (
                  "Not configured"
                ) : (
                  "Not connected"
                )}
              </span>
              {connected ? (
                <details className="account-actions">
                  <summary>Manage</summary>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => setRemove(platform)}
                  >
                    Disconnect {accountNames[platform]}
                  </button>
                </details>
              ) : (
                <button
                  className="secondary"
                  disabled={
                    !loaded ||
                    !!busy ||
                    !state.configured ||
                    account?.configured === false
                  }
                  onClick={() => void act(platform)}
                >
                  <Link2 size={14} />
                  {busy === platform
                    ? "Connecting…"
                    : `${account?.reauth ? "Reconnect" : "Connect"} ${accountNames[platform]}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!state.configured && loaded ? (
        <p className="hint">
          Social connections aren’t configured yet. You can download your video
          and copy its captions.
        </p>
      ) : (
        <p className="hint">
          Connect once through each platform’s secure approval screen. You’ll
          return to this reel.
        </p>
      )}
      <ConfirmDialog
        open={!!remove}
        title={`Disconnect ${remove ? platformNames[remove] : ""}?`}
        description="New posts will no longer go to this account. Already accepted schedules stay active."
        confirmLabel="Disconnect account"
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          if (remove) void act(remove, true);
        }}
      />
    </section>
  );
}

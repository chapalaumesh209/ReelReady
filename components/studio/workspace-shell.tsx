"use client";
import type { ReactNode } from "react";
import { Logo } from "./index";

/** One task surface. No dashboard, destination navigation or preferences. */
export function WorkspaceShell({
  children,
  actions,
}: {
  children: ReactNode;
  section: "reels" | "studio" | "accounts" | "settings";
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="single-flow">
      <a className="skip-link" href="#workspace">
        Skip to main content
      </a>
      <header className="flow-header">
        <div className="brand" aria-label="ReelReady">
          <Logo />
          <span>
            reelready<span className="brand-dot">.</span>
          </span>
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

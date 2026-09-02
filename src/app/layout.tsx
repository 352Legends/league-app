import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "./scheme.css";

export const metadata: Metadata = {
  title: "WAR ROOM · Fantasy Football Championship Intelligence",
  description: "Decision intelligence for fantasy football championships.",
};

const nav = [
  ["Command Center", "/"],
  ["My Team", "/connect"],
  ["This Week", "/connect"],
  ["Waivers", "/connect"],
  ["Trades", "/connect"],
  ["Breakout Radar", "/breakouts"],
  ["Chess Mode", "/connect"],
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <Link href="/" className="brand">
              <span className="brand-mark">W</span>
              <span><strong>WAR ROOM</strong><small>CHAMPIONSHIP INTELLIGENCE</small></span>
            </Link>
            <nav>
              {nav.map(([label, href], index) => (
                <Link href={href} key={`${label}-${index}`} className={index === 0 ? "nav-link nav-link--active" : "nav-link"}>
                  <span className="nav-dot" />{label}
                </Link>
              ))}
            </nav>
            <div className="sidebar-footer">
              <span className="pulse" />
              <div><strong>Data engine</strong><small>Sleeper + nflverse live</small></div>
            </div>
          </aside>
          <main className="main-shell">
            <header className="topbar">
              <div><span className="topbar-label">2026 NFL SEASON</span><strong>WAR ROOM / LIVE</strong></div>
              <Link href="/connect" className="connect-button">Connect League</Link>
            </header>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

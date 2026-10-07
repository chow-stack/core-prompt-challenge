import { Suspense, lazy, useEffect } from "react";
import { Toasts } from "./components/Toasts.tsx";
import { navigate, useLocation } from "./hooks.ts";
import { Board } from "./screens/Board.tsx";
import { Home } from "./screens/Home.tsx";
import { Live } from "./screens/Live.tsx";
import { Solo } from "./screens/Solo.tsx";

// Host screens are split out so players never download the QR library.
const HostStart = lazy(() => import("./screens/Host.tsx").then((m) => ({ default: m.HostStart })));
const HostStage = lazy(() => import("./screens/Host.tsx").then((m) => ({ default: m.HostStage })));
const loading = <p className="muted">Loading...</p>;

const UUID = "[0-9a-f-]{36}";

function Link({ to, children }: { to: string; children: string }) {
  const { path } = useLocation();
  const on = to === "/" ? path === "/" : path.startsWith(to);
  return (
    <a
      href={to}
      aria-current={on ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function App() {
  const { path, search } = useLocation();
  const code = (search.get("code") ?? "").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4);

  useEffect(() => {
    const titles: [RegExp, string][] = [
      [/^\/play/, "Play"],
      [/^\/board/, "Leaderboard"],
      [/^\/game\//, "Live game"],
      [/^\/host/, "Host"],
    ];
    const t = titles.find(([rx]) => rx.test(path))?.[1];
    document.title = (t ? t + " · " : "") + "The CORE Prompt Challenge · Gen AI Club";
  }, [path]);

  const hostMatch = path.match(new RegExp(`^/host/(${UUID})$`));
  if (hostMatch)
    return (
      <Suspense fallback={loading}>
        <HostStage gameId={hostMatch[1]} />
      </Suspense>
    );

  let screen;
  let wide = false;
  const gameMatch = path.match(new RegExp(`^/game/(${UUID})$`));
  if (path === "/") screen = <Home prefillCode={code} />;
  else if (path === "/play") {
    const s = Number(search.get("s"));
    screen = <Solo step={Number.isInteger(s) && s >= 1 ? s - 1 : null} summary={false} />;
  } else if (path === "/play/summary") screen = <Solo step={null} summary />;
  else if (path === "/board") {
    wide = true;
    screen = <Board seasonParam={search.get("season")} />;
  } else if (gameMatch) screen = <Live gameId={gameMatch[1]} />;
  else if (path === "/host") screen = <HostStart />;
  else
    screen = (
      <>
        <h1>Page not found</h1>
        <button className="btn" type="button" onClick={() => navigate("/")}>
          Back to home
        </button>
      </>
    );

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header>
        <div className="wrap">
          <div className="bar-top">
            <a
              className="brand"
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigate("/");
              }}
            >
              Gen AI Club | Prompt Engineering
            </a>
            <nav className="topnav" aria-label="Main">
              <Link to="/play">Play</Link>
              <Link to="/board">Leaderboard</Link>
              <Link to="/host">Host</Link>
            </nav>
          </div>
        </div>
      </header>
      <main id="main" className={wide ? "wide" : undefined}>
        <Suspense fallback={loading}>{screen}</Suspense>
      </main>
      <Toasts />
      <footer>Gen AI Club | Indiana University | The CORE Prompt Challenge</footer>
    </>
  );
}

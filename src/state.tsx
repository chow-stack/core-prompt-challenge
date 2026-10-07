import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, auth, errorText } from "./api.ts";
import type { Player, Scenario } from "./types.ts";

type Ctx = {
  /** undefined while loading, null when this device has no player yet. */
  me: Player | null | undefined;
  setMe: (p: Player | null) => void;
  scenarios: Scenario[];
  bootError: string;
  reload: () => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Player | null | undefined>(undefined);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [bootError, setBootError] = useState("");
  const load = useCallback(() => {
    setBootError("");
    auth()
      .then(() => Promise.all([api.me(), api.scenarios()]))
      .then(([p, s]) => {
        setMe(p);
        setScenarios(s);
      })
      .catch((e) => {
        setMe(null);
        setBootError(errorText(e));
      });
  }, []);
  useEffect(load, [load]);
  return <AppCtx.Provider value={{ me, setMe, scenarios, bootError, reload: load }}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppProvider missing");
  return c;
}

import { useEffect, useMemo, useState } from "preact/hooks";
import type { Job } from "../shared/types";
import { Icon } from "./components/Icon";
import { MediaCard } from "./components/MediaCard";
import { FirstRun, HistoryList, StateCard } from "./components/Panels";
import { Settings } from "./components/Settings";
import { t } from "./i18n";
import { rank } from "./rank";
import { useGrabby } from "./store";

const prefersDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

function latestJob(jobs: Job[], mediaId: string): Job | undefined {
  return jobs
    .filter((j) => j.mediaId === mediaId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

export function App() {
  const { state, send } = useGrabby();
  const [tab, setTab] = useState<"page" | "history">("page");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The card showing its choices: the first one until the user opens another ('' = none).
  const [openId, setOpenId] = useState<string | undefined>();
  const [systemDark, setSystemDark] = useState(prefersDark());

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const theme = state?.settings.theme ?? "auto";
  const dark = theme === "dark" || (theme === "auto" && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  const items = useMemo(() => rank(state?.items ?? []), [state?.items]);
  const prefs = {
    video: state?.settings.videoFormat ?? "mp4",
    audio: state?.settings.audioFormat ?? "m4a",
  } as const;
  const openCard = openId ?? items[0]?.id;

  return (
    <div class="app">
      {settingsOpen && state ? (
        <Settings
          settings={state.settings}
          browserAsks={!!state.browserAsks}
          onChange={(patch) => send({ type: "settings", patch })}
          onOpenBrowserSettings={() => send({ type: "open-browser-downloads" })}
          onClose={() => setSettingsOpen(false)}
        />
      ) : (
        <>
          <header class="top">
            <span class="brand">
              <span class="brand__tile">
                <Icon name="logo" size={18} />
              </span>
              Grabby
            </span>
            <span class="top__tools">
              <button
                class="icon-btn"
                aria-label={dark ? t("switchToLight") : t("switchToDark")}
                title={dark ? t("switchToLight") : t("switchToDark")}
                onClick={() =>
                  send({
                    type: "settings",
                    patch: { theme: dark ? "light" : "dark" },
                  })
                }
              >
                <Icon name={dark ? "sun" : "moon"} />
              </button>
              <button
                class="icon-btn"
                aria-label={t("openSettings")}
                title={t("openSettings")}
                onClick={() => setSettingsOpen(true)}
              >
                <Icon name="settings" />
              </button>
            </span>
          </header>

          <nav class="seg" role="tablist">
            {(["page", "history"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                class={tab === k ? "on" : ""}
                onClick={() => setTab(k)}
              >
                {k === "page" ? t("tabPage") : t("tabHistory")}
                {k === "page" && items.length > 0 && (
                  <span class="count">{items.length}</span>
                )}
              </button>
            ))}
          </nav>

          <main class="content">
            {!state ? (
              <div class="skeleton" aria-busy="true" />
            ) : tab === "history" ? (
              <HistoryList entries={state.history} send={send} />
            ) : (
              <>
                {!state.settings.firstRunAck && (
                  <FirstRun
                    onOk={() =>
                      send({ type: "settings", patch: { firstRunAck: true } })
                    }
                  />
                )}
                {state.blocked === "youtube" ? (
                  <StateCard
                    icon="shield"
                    title={t("ytTitle")}
                    body={t("ytBody")}
                  />
                ) : state.blocked === "restricted" ? (
                  <StateCard
                    icon="lock"
                    title={t("restrictedTitle")}
                    body={t("restrictedBody")}
                  />
                ) : !items.length ? (
                  <StateCard
                    icon="film"
                    title={t("emptyTitle")}
                    body={t("emptyBody")}
                  />
                ) : (
                  <section class="list" aria-label={t("tabPage")}>
                    {items.map((i) => (
                      <MediaCard
                        key={i.id}
                        item={i}
                        job={latestJob(state.jobs, i.id)}
                        open={i.id === openCard}
                        onToggle={() =>
                          setOpenId(i.id === openCard ? "" : i.id)
                        }
                        preferred={prefs}
                        send={send}
                      />
                    ))}
                  </section>
                )}
              </>
            )}
          </main>
        </>
      )}
    </div>
  );
}

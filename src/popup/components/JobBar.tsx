import type { PopupToBg } from "../../shared/messages";
import type { Job } from "../../shared/types";
import { size, t } from "../i18n";
import { Icon } from "./Icon";

const ACTIVE = ["queued", "downloading", "capturing", "processing", "saving"];

export const isActive = (j: Job | undefined): boolean =>
  !!j && ACTIVE.includes(j.status);

function label(job: Job): string {
  const pct = `${Math.round(job.progress * 100)} %`;
  switch (job.status) {
    case "downloading":
      return job.progress > 0
        ? `${t("st_downloading")} ${pct}`
        : t("st_downloading");
    case "capturing":
      return `${t("st_capturing")} ${pct}`;
    case "processing":
      // Shrinking the picture is long and measured: show how far it is.
      return job.scale ? `${t("st_converting")} ${pct}` : t("st_processing");
    default:
      return t(`st_${job.status}`);
  }
}

/** "12 s", "4 min", "1 h 05". */
function duration(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600);
  return `${h} h ${String(Math.round((sec % 3600) / 60)).padStart(2, "0")}`;
}

/** "56 Mo / 250 Mo", the speed and the time left, while data comes in. */
export function jobStats(job: Job): string[] {
  const parts: string[] = [];
  const total = job.total && job.total >= job.bytes ? job.total : undefined;
  if (job.bytes > 0)
    parts.push(
      total
        ? `${size(job.bytes)} / ${job.totalApprox ? "≈ " : ""}${size(total)}`
        : size(job.bytes),
    );
  else if (total) parts.push(`${job.totalApprox ? "≈ " : ""}${size(total)}`);
  const moving = job.status === "downloading" || job.status === "capturing";
  if (moving && job.speed > 0) {
    parts.push(`${size(job.speed)}/s`);
    if (total)
      parts.push(t("jobLeft", duration((total - job.bytes) / job.speed)));
  }
  return parts;
}

function MeterLabel({ text }: { text: string }) {
  return (
    <span class="meter__label">
      <span>{text}</span>
    </span>
  );
}

/**
 * The download pill turned into its own progress bar: the coral fill grows inside
 * the button the user just pressed, so the result appears where the action happened.
 */
export function JobBar({
  job,
  send,
  canFinish = true,
}: {
  job: Job;
  send: (m: PopupToBg) => void;
  canFinish?: boolean;
}) {
  if (job.status === "done") {
    return (
      <div class="job job--done" role="status">
        <span class="job__msg">
          <Icon name="check" size={16} />
          {t("st_done")}
          {job.bytes ? <span class="muted">{size(job.bytes)}</span> : null}
        </span>
        <div class="job__actions">
          {job.downloadId !== undefined && (
            <button
              class="pill pill--ghost"
              onClick={() =>
                send({ type: "show", downloadId: job.downloadId! })
              }
            >
              <Icon name="folder" size={16} />
              {t("showFile")}
            </button>
          )}
          {/* Back to the choices (quality, format) for another download. */}
          <button
            class="icon-btn icon-btn--solid"
            title={t("redownload")}
            aria-label={t("redownload")}
            onClick={() => send({ type: "dismiss", jobId: job.id })}
          >
            <Icon name="retry" size={18} />
          </button>
        </div>
      </div>
    );
  }

  if (job.status === "error" || job.status === "canceled") {
    return (
      <div class={`job job--${job.status}`} role="alert">
        <p class="job__error">
          {job.status === "canceled"
            ? t("st_canceled")
            : t(`err_${job.error ?? "unknown"}`)}
        </p>
        <div class="job__actions">
          <button
            class="pill pill--ghost"
            onClick={() => send({ type: "dismiss", jobId: job.id })}
          >
            {t("dismiss")}
          </button>
          {job.error !== "protected" && job.error !== "live" && (
            <button
              class="pill"
              onClick={() => send({ type: "retry", jobId: job.id })}
            >
              <Icon name="retry" size={16} />
              {t("retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const indeterminate =
    job.status === "queued" ||
    (job.status === "processing" && !job.scale) ||
    job.status === "saving" ||
    job.progress === 0;
  const stats = jobStats(job);
  return (
    <div class="job-wrap">
      <div class="job job--active">
        <div
          class={`meter${indeterminate ? " meter--busy" : ""}`}
          style={{ "--p": String(indeterminate ? 1 : job.progress) }}
          role="progressbar"
          aria-label={label(job)}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(indeterminate
            ? {}
            : { "aria-valuenow": Math.round(job.progress * 100) })}
        >
          <MeterLabel text={label(job)} />
          {/* Same label, dark, clipped to the coral fill: readable on both colors. */}
          <span class="meter__fill" aria-hidden="true">
            <MeterLabel text={label(job)} />
          </span>
        </div>
        {job.status === "capturing" && canFinish && (
          <button
            class="icon-btn icon-btn--solid"
            title={t("finishCapture")}
            aria-label={t("finishCapture")}
            onClick={() => send({ type: "finish-capture", jobId: job.id })}
          >
            <Icon name="stop" />
          </button>
        )}
        <button
          class="icon-btn"
          title={t("cancel")}
          aria-label={t("cancel")}
          onClick={() => send({ type: "cancel", jobId: job.id })}
        >
          <Icon name="close" />
        </button>
      </div>
      {stats.length > 0 && (
        <p class="job__stats">
          {stats.map((s, i) => (
            <span key={i}>{s}</span>
          ))}
        </p>
      )}
    </div>
  );
}

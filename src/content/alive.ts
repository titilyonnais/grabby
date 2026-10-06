/*
 * Grabby updated or reloaded while a page stays open: the scripts already in that page lose
 * their extension, and every `chrome.*` call then throws (« Extension context invalidated »).
 * They check `alive()` before talking to it, and on the first sign of it gone they take their
 * buttons off the page and stop: the new Grabby puts its own in.
 *
 * After an update, Grabby also puts its script back into open pages. A copy that finds another
 * one still answering in the page (it came in right after the page's own) stays out of the way;
 * one that finds it cut off takes over.
 */
const own = (): boolean => {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
};

const slot = globalThis as { __grabby?: () => boolean };
const before = slot.__grabby;
let first: boolean;
try {
  first = !before || !before();
} catch {
  first = true;
}
if (first) slot.__grabby = own;

/** Another copy of the script already runs this page, and still answers: this one does nothing. */
export const superfluous = !first;

/** This copy runs the page and its extension still answers. */
export function alive(): boolean {
  return slot.__grabby === own && own();
}

/**
 * A call to Chrome, made only while this copy runs the page; `fallback` otherwise, and when
 * Chrome throws anyway (the extension being reloaded at that very moment).
 */
export function safely<T>(call: () => T, fallback: T): T {
  if (!alive()) return fallback;
  try {
    return call();
  } catch {
    return fallback;
  }
}

/** A message to the service worker that never throws (resolves to `fallback` when it can't go). */
export function message<T = unknown>(msg: unknown, fallback?: T): Promise<T | undefined> {
  return safely(
    () =>
      (chrome.runtime.sendMessage(msg) as Promise<T>).then(
        (r) => r ?? fallback,
        () => fallback,
      ),
    Promise.resolve(fallback),
  );
}

const farewells: (() => void)[] = [];
let watchdog: ReturnType<typeof setInterval> | undefined;

function check() {
  if (alive()) return;
  clearInterval(watchdog);
  for (const fn of farewells.splice(0)) {
    try {
      fn();
    } catch {
      /* the page changed under it */
    }
  }
}

/** Runs `fn` once the extension is gone (checked every 2 seconds). */
export function onDead(fn: () => void): void {
  farewells.push(fn);
  watchdog ??= setInterval(check, 2000);
}

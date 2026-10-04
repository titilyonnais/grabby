import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BgToPopup, PopupState, PopupToBg } from '../shared/messages';

async function currentTabId(): Promise<number> {
  const forced = new URLSearchParams(location.search).get('tab');
  if (forced) return Number(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? -1;
}

/** Live popup state pushed by the service worker over a long-lived port. */
export function useGrabby() {
  const [state, setState] = useState<PopupState | null>(null);
  const port = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    let disposed = false;
    let p: chrome.runtime.Port;
    const connect = async () => {
      const tabId = await currentTabId();
      if (disposed) return;
      p = chrome.runtime.connect({ name: 'popup' });
      port.current = p;
      p.onMessage.addListener((m: BgToPopup) => {
        if (m.type === 'state') setState(m.state);
      });
      // The service worker may restart: reconnect transparently.
      p.onDisconnect.addListener(() => {
        if (!disposed) setTimeout(connect, 150);
      });
      p.postMessage({ type: 'subscribe', tabId } satisfies PopupToBg);
    };
    void connect();
    return () => {
      disposed = true;
      p?.disconnect();
    };
  }, []);

  const send = useMemo(() => (msg: PopupToBg) => port.current?.postMessage(msg), []);
  return { state, send };
}

import { useSyncExternalStore } from 'react';

function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

/** true chỉ sau khi hydrate trên client — dùng để khớp SSR với persist (localStorage). */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

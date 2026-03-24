import { useEffect, useState } from 'react';

/** true chỉ sau khi component mount trên client — dùng để khớp SSR với persist (localStorage). */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

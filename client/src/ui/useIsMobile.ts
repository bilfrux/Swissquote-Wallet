import { useEffect, useState } from "react";

// Mise en page « téléphone » sous 820 px de large.
export function useIsMobile(breakpoint = 820) {
  const q = `(max-width: ${breakpoint}px)`;
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

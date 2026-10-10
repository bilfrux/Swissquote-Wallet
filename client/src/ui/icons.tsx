// Icônes au trait (dessinées pour l'appli, pas de fichiers de marque). Couleur : currentColor.
const S = (p: { children: React.ReactNode; size?: number }) => (
  <svg width={p.size ?? 22} height={p.size ?? 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.children}</svg>
);
export const IconHome = () => <S><path d="M4 11 12 4l8 7" /><path d="M6 10v9h4v-5h4v5h4v-9" /></S>;
export const IconBank = () => <S><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></S>;
export const IconCrypto = () => <S><circle cx="12" cy="12" r="8.5" /><path d="M10 7.5v9M12.5 7.5v1.5M12.5 15v1.5M9 9h4.2a1.9 1.9 0 0 1 0 3.8H9M9 12.8h4.6a1.9 1.9 0 0 1 0 3.7H9" /></S>;
export const IconPortfolio = () => <S><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 15v-3M12 15V9M16 15v-5" /></S>;
export const IconShield = () => <S><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></S>;
export const IconBolt = () => <S><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" /></S>;
export const IconUser = () => <S><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18.5a6.5 6.5 0 0 1 11 0" /></S>;
export const IconReceive = () => <S><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></S>;
export const IconSend = () => <S><path d="M12 20V8M7 13l5-5 5 5M5 4h14" /></S>;
export const IconList = () => <S><path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" /></S>;
export const IconRefresh = () => <S><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /></S>;
export const IconChevron = () => <S size={18}><path d="m9 6 6 6-6 6" /></S>;
export const IconCash = () => <S><rect x="3" y="7" width="18" height="10" rx="1.5" /><circle cx="12" cy="12" r="2.2" /></S>;
export const IconSavings = () => <S><path d="M5 11c0-3 3-5 7-5s7 2 7 5-3 6-7 6-7-3-7-6Z" /><path d="M12 6V4M9 20l1-3M15 20l-1-3" /></S>;

// Marque redessinée (rond rouge + mot-symbole). Remplaçable par le logo officiel du kit de marque.
export const Logo = ({ size = 26 }: { size?: number }) => (
  <span className="brand" aria-label="Swissquote">
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#e8312f" />
      <path d="M21 11.2C20.2 9.6 18.4 8.8 16 8.8c-3 0-5 1.4-5 3.4 0 4.6 10.2 2.6 10.2 7.4 0 2.1-2.2 3.6-5.3 3.6-2.6 0-4.5-1-5.4-2.7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
    <span className="brand-word">Swissquote</span>
  </span>
);

export const SwissFlag = () => (
  <svg width="22" height="22" viewBox="0 0 32 32" aria-label="CHF"><circle cx="16" cy="16" r="16" fill="#e8312f" /><path d="M13.5 8h5v5.5H24v5h-5.5V24h-5v-5.5H8v-5h5.5Z" fill="#fff" /></svg>
);

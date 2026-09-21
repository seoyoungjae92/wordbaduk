/* 토스 SDK 어댑터.
   토스 안에서는 SDK를, 브라우저에서는 폴백을 쓴다.
   덕분에 같은 코드를 일반 브라우저에서 그대로 열어 확인할 수 있다. */

let sdk = null;
try {
  // 번들러가 없는 환경(프로토타입 미리보기)에서도 깨지지 않게 동적으로 잡는다
  sdk = globalThis.__AIT__ ?? null;
} catch { /* 무시 */ }

export const inToss = () => sdk != null;

/* ── 저장소 ──────────────────────────────
   토스: Storage API(기기 저장소). 브라우저: localStorage.
   둘 다 실패할 수 있으므로 호출부는 항상 기본값을 가정해야 한다. */
export const storage = {
  async get(key) {
    try {
      if (sdk?.Storage) return await sdk.Storage.getItem({ name: key });
      return localStorage.getItem(key);
    } catch { return null; }
  },
  async set(key, value) {
    try {
      if (sdk?.Storage) return await sdk.Storage.setItem({ name: key, value });
      localStorage.setItem(key, value);
    } catch { /* 저장 실패는 조용히 넘긴다 */ }
  },
  async remove(key) {
    try {
      if (sdk?.Storage) return await sdk.Storage.removeItem({ name: key });
      localStorage.removeItem(key);
    } catch { /* 무시 */ }
  },
};

/* ── 게임센터 리더보드 ───────────────────
   순위 UI와 데이터는 토스가 관리한다. 우리 서버는 없다.
   점수 유효성만 게임 쪽에서 책임진다. */
export const leaderboard = {
  available: () => Boolean(sdk?.Game?.setLeaderboardScore),
  async submit(score) {
    if (!sdk?.Game?.setLeaderboardScore) return { statusCode: 'UNAVAILABLE' };
    try {
      return await sdk.Game.setLeaderboardScore({ score: String(score) });
    } catch {
      return { statusCode: 'ERROR' };
    }
  },
  async open() {
    try { await sdk?.Game?.openLeaderboard?.(); } catch { /* 무시 */ }
  },
};

/* ── 햅틱 ────────────────────────────────
   토스에 햅틱 API가 있으면 그걸 쓰고, 없으면 웹 진동으로 떨어진다. */
export function haptic(pattern) {
  try {
    if (sdk?.Haptic?.vibrate) { sdk.Haptic.vibrate(); return; }
    navigator.vibrate?.(pattern);
  } catch { /* 무시 */ }
}

/* ── 안전 영역 ───────────────────────────
   Dynamic Island를 침범하지 않도록 CSS 변수로 내려준다.
   SDK가 없으면 env(safe-area-inset-*)가 그대로 쓰인다. */
export function applySafeArea() {
  try {
    const inset = sdk?.SafeArea?.get?.();
    if (!inset) return;
    const root = document.documentElement.style;
    root.setProperty('--sa-top', `${inset.top ?? 0}px`);
    root.setProperty('--sa-bottom', `${inset.bottom ?? 0}px`);
  } catch { /* 무시 */ }
}

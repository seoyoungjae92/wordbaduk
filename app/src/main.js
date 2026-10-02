import './style.css';
import { startGame } from './game.js';
import * as platform from './platform.js';

platform.applySafeArea();

/* 사전 2.4MB는 번들에 섞지 않고 자산으로 받는다.
   미니앱 번들에 같이 실려 나가므로 첫 실행 뒤에는 네트워크가 필요 없다. */
async function boot() {
  const [dictRes, savedRaw] = await Promise.all([
    fetch(import.meta.env.BASE_URL + 'dict.json'),
    platform.storage.get('wchain5'),          // 토스 Storage는 비동기다
  ]);
  const dict = await dictRes.json();

  let saved = {};
  try { saved = savedRaw ? JSON.parse(savedRaw) : {}; } catch { saved = {}; }

  startGame({
    DICT_IDX: dict.idx,
    DICT_TIERS: dict.tiers,
    DEX_MAIN: dict.dexMain,
    DEX_HARD: dict.dexHard,
    platform,
    saved,
  });
}

boot();

/* 서비스 워커. TWA(안드로이드 래퍼)가 요구하는 조건이기도 하고,
   웹에서 열었을 때 오프라인으로 돌게 해준다. 실패해도 게임은 그대로 돈다. */
/* 토스 안에서는 등록하지 않는다. 미니앱은 번들을 통째로 받아 쓰기 때문에
   서비스 워커가 끼면 새 번들이 와도 낡은 화면이 남는다. 웹/TWA에서만 필요하다. */
if (!platform.inToss() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL })
      .catch(() => {});
  });
}

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

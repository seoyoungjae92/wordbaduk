/* 정적 서버.
   Railway는 정적 파일을 그냥 서빙해주지 않아서 얇은 서버를 하나 둔다.
   express 같은 걸 얹을 이유가 없어서 Node 기본 모듈만 쓴다. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const PORT = process.env.PORT || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
};

function cacheFor(path) {
  // 서비스 워커를 캐시하면 새 버전이 영영 안 내려간다
  if (path.endsWith('sw.js')) return 'no-cache';
  // Vite가 해시를 붙인 파일은 영구 캐시해도 안전하다
  if (path.includes('/assets/')) return 'public, max-age=31536000, immutable';
  // 사전은 바뀔 일이 드물지만 해시가 없으니 하루만
  if (path.endsWith('dict.json')) return 'public, max-age=86400';
  return 'public, max-age=300';
}

async function send(res, path, status = 200) {
  const body = await readFile(path);
  res.writeHead(status, {
    'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
    'Cache-Control': cacheFor(path),
    // 루트 스코프로 서비스 워커를 등록할 수 있게
    'Service-Worker-Allowed': '/',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // 상위 경로 탈출 방지
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let path = join(ROOT, rel);

    try {
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      return await send(res, path);
    } catch {
      // 없는 경로는 앱 껍데기로 돌려준다 (단일 페이지)
      return await send(res, join(ROOT, 'index.html'));
    }
  } catch {
    res.writeHead(500).end('server error');
  }
}).listen(PORT, () => console.log(`wordbaduk on :${PORT}`));

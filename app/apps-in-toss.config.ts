import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 콘솔에 등록한 앱 키와 같아야 한다. 딥링크·배포에 쓰인다.
  appName: 'wordbaduk',
  brand: {
    primaryColor: '#2C5B4E',   // 바둑판 대국 정보에 쓰는 짙은 청록
  },
  // 이 게임은 사전이 번들에 들어 있어 기기 권한이 필요 없다
  permissions: [],
  navigationBar: {
    withBackButton: true,
    withHomeButton: false,
    withTitle: false,
    transparentBackground: true,
    theme: 'light',
  },
  webView: {
    // 대국 중 당겨서 새로고침되면 판이 날아간다
    pullToRefreshEnabled: false,
    bounces: false,
    overScrollMode: 'never',
    // 효과음이 사용자 조작 없이도 나야 한다(첫 탭에서 오디오를 깨운다)
    mediaPlaybackRequiresUserAction: false,
    allowsInlineMediaPlayback: true,
  },
  webBundleDir: 'dist',
});

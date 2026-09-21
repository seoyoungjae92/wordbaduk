import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 콘솔에 등록한 앱 정보와 같아야 한다. 딥링크·배포 키로도 쓰인다.
  appName: 'wordbaduk',
  brand: {
    displayName: '끝말잇기 대국',
    primaryColor: '#2C5B4E',
    icon: '', // TODO: 콘솔 앱 정보의 이미지 URL
  },
  web: {
    host: 'localhost',
    port: 5173,
    commands: {
      dev: 'vite dev',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
});

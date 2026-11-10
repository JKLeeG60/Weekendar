import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 체험용 단일 HTML 빌드: 외부 폰트 CDN 링크는 제거하고 시스템 한글 폰트를 사용한다.
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    {
      name: 'strip-external-font',
      transformIndexHtml: (html) => html.replace(/<link rel="stylesheet"[^>]*pretendard[^>]*>/g, ''),
    },
  ],
  build: { outDir: 'dist-single', emptyOutDir: true },
})

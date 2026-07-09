/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 同时加载根目录和 frontend 目录的 .env*，后者覆盖前者
  // 空 prefix '' 使 VITE_PORT 等非 VITE_ 前缀变量也能被 Node 侧 config 读取
  const rootEnvDir = path.resolve(__dirname, '..')
  const env = {
    ...loadEnv(mode, rootEnvDir, ''),
    ...loadEnv(mode, __dirname, ''),
  }
  const apiBaseUrl = env.VITE_BACKEND_BASE_URL || 'http://127.0.0.1:8000'
  const devPort = Number(env.VITE_PORT) || 5177

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: devPort,
      proxy: {
        '/api': {
          target: apiBaseUrl,
          changeOrigin: true,
        },
        '/pipeline': {
          target: apiBaseUrl,
          changeOrigin: true,
        },
        '/static': {
          target: apiBaseUrl,
          changeOrigin: true,
        },
        '/admin': {
          target: apiBaseUrl,
          changeOrigin: true,
        },
      },
    },
    // 构建配置：按厂商拆分 vendor chunk，配合路由级 React.lazy 实现细粒度代码分割
    // 使用 rolldown 原生 codeSplitting.groups（manualChunks 在 rolldown-vite 下不生效），
    // priority 越大越先匹配；jsx-runtime 必须先于 react-vendor / markdown-vendor 等匹配，
    // 否则 rolldown 会把 react/jsx-runtime 内联到多个 chunk，导致入口强制 import markdown-vendor。
    build: {
      rollupOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'react-jsx-runtime',
                test: /[\\/]node_modules[\\/]react[\\/](jsx-runtime|jsx-dev-runtime|cjs[\\/]react-jsx-(dev-)?runtime)/,
                priority: 100,
              },
              {
                name: 'react-vendor',
                test: /[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/,
                priority: 90,
              },
              {
                name: 'd3-vendor',
                test: /[\\/]node_modules[\\/]d3(-[^\\/]+)?[\\/]/,
                priority: 80,
              },
              {
                name: 'markmap-view-vendor',
                test: /[\\/]node_modules[\\/](markmap-view|markmap-toolbar)[\\/]/,
                priority: 80,
              },
              {
                name: 'html-parser-vendor',
                test: /[\\/]node_modules[\\/](cheerio|htmlparser2|parse5[^\\/]*|domhandler|domutils|dom-serializer|entities|css-select|css-what|nth-check|boolbase|domelementtype)[\\/]/,
                priority: 78,
              },
              {
                name: 'markdown-it-vendor',
                test: /[\\/]node_modules[\\/]markdown-it[^\\/]*[\\/]/,
                priority: 76,
              },
              {
                name: 'markmap-lib-vendor',
                test: /[\\/]node_modules[\\/](markmap-lib|markmap-common|markmap-html-parser)[\\/]/,
                priority: 74,
              },
              {
                name: 'markdown-vendor',
                test: /[\\/]node_modules[\\/](react-markdown|remark-[^\\/]+|rehype-[^\\/]+|highlight\.js|unified|mdast-[^\\/]+|hast-[^\\/]+|micromark[^\\/]*|decode-named-character-reference|character-entities[^\\/]*|property-information|space-separated-tokens|comma-separated-tokens|zwitch|vfile[^\\/]*|bail|is-plain-obj|trough|devlop)[\\/]/,
                priority: 60,
              },
              {
                name: 'radix-vendor',
                test: /[\\/]node_modules[\\/](radix-ui|@radix-ui)[\\/]/,
                priority: 50,
              },
              {
                name: 'form-vendor',
                test: /[\\/]node_modules[\\/](react-hook-form|@hookform[\\/]resolvers|zod)[\\/]/,
                priority: 50,
              },
              {
                name: 'i18n-vendor',
                test: /[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/,
                priority: 50,
              },
              {
                name: 'router-vendor',
                test: /[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/,
                priority: 50,
              },
              {
                name: 'export-vendor',
                test: /[\\/]node_modules[\\/](html-to-image|react-to-print)[\\/]/,
                priority: 50,
              },
              {
                name: 'icons-vendor',
                test: /[\\/]node_modules[\\/](lucide-react)[\\/]/,
                priority: 50,
              },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})

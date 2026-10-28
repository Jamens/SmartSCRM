import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/*.bundle.js', '**/*.bundle.mjs', '**/tmp/**'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // 接口/回调里故意留着、用 `_` 前缀显式标注"未使用"的参数（如抽象基类默认实现、
      // 后续阶段才实现的 sendMessage）按约定忽略，不污染 error 计数。
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    // 构建脚本 / 集成测试脚本是 JS（.mjs / .js），无法写 TS 返回类型注解，且该规则对其无意义。
    // `test/**/*.js` 也在内：Electron 主脚本（如 fingerprint-probe/probe-main.js）只能是 CJS 的
    // .js，require() 是它唯一可用的导入方式。
    files: ['scripts/**/*.mjs', 'test/**/*.mjs', 'test/**/*.js', '**/*.bundle.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    // 测试里的 mock / stub 天然有空方法体（如 `off()`、`ref()`/`unref()` 的计时器替身），属正常写法。
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off'
    }
  },
  eslintConfigPrettier
)

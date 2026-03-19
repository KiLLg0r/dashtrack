import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      // TypeScript
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Ternaries used as statements for side-effects (vid.paused ? vid.play() : vid.pause()) are
      // valid in this codebase — disable the no-unused-expressions rule.
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-unused-expressions': 'off',

      // React hooks — only the stable v4 rules; disable React Compiler rules (v5+)
      // that flag intentional ref-lazy-init and direct setState patterns used here.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/refs': 'off',
      'react-hooks/react-compiler': 'off',

      // General
      'no-console': 'warn',
      'no-debugger': 'error',
    },
  },
]

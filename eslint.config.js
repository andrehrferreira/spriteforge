import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    {
        ignores: ['dist/', 'node_modules/', 'data/', '.rulebook/', '.claude/', '.playwright-mcp/'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            // polling usa for(;;) com saída por return/throw
            'no-constant-condition': ['error', { checkLoops: false }],
        },
    },
    {
        files: ['server/**/*.mjs', 'vite.config.ts'],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        files: ['src/**/*.ts', 'tests/**/*.ts'],
        languageOptions: {
            globals: globals.browser,
        },
    },
)

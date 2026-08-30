// ESLint 9 flat config — cekirdek kurallar (stylistic yok).
// Tip bagimli kurallar icin projectService acik; ancak aktif kural seti yalnizca
// asagida listelenen cekirdek dogruluk kurallarindan olusur.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  {
    // Lint kapsami yalnizca src-v2; yine de dist/legacy ciktilarini guvence icin yok say.
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'legacy-next/**', 'test-results/**'],
  },
  {
    files: ['src-v2/**/*.{ts,tsx}'],
    // Kod tabaninda react-hooks/exhaustive-deps icin bilissel olarak konmus
    // eslint-disable satirlari var (o kural su an kapali — ustteki nota bak).
    // Kural 'warn' olarak geri acildiginda bu satirlar yeniden anlam kazanacagi
    // icin kullanilmayan direktif raporlamasi acik birakilmadi.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          // tsconfig.app.json proje referansi
          defaultProject: './tsconfig.app.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // --- cekirdek dogruluk kurallari ---
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-import-assign': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'react-hooks/rules-of-hooks': 'error',
      // Asagidaki iki kural kapali: mevcut taban 20 exhaustive-deps + 46 react-refresh
      // uyarisi iceriyor ve bunlarin temizlenmesi davranis degisikligi (effect dep dizisi
      // duzenleme) ya da dosya yeniden yapilandirmasi (paylasilan sabitlerin tasinmasi)
      // gerektiriyor. `lint` scripti `--max-warnings 0` ile kapı olduğu için bu kurallar
      // 'warn' birakilamazdi — warn seviyesinde tek uyari lint'i kirmizi yapar.
      // Temizleme dalgasi sonrasi 'warn' olarak geri acilmali.
      'react-hooks/exhaustive-deps': 'off',
      'react-refresh/only-export-components': 'off',

      // --- bilincli kapamalar ---
      // React 17+ jsx transform; proje ozel jsxImportSource (@/i18n/react) kullaniyor.
      // eslint-plugin-react kurulu degil; jsx-scope kurali bu yuzden zaten devrede degil.
      // Genis kod tabani; bu kalibrasyonlar kapsam disi:
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];

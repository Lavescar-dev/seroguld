/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src-v2/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f3ef',
          100: '#e8e3d9',
          200: '#d9d0bf',
          300: '#c0b296',
          400: '#a8906f',
          500: '#8e7556',
          600: '#755f44',
          700: '#6b5848',
          800: '#52402e',
          900: '#302018',
          950: '#1c120c'
        }
      }
    },
  },
  plugins: [],
};

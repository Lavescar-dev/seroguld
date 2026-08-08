/** @type {import('tailwindcss').Config} */
const sg = (name) => `rgb(var(${name}) / <alpha-value>)`;

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
        },
        // Modern UI token'ları — tek kaynak src-v2/styles/tokens.css
        sg: {
          bg: sg('--sg-bg-rgb'),
          'bg-strong': sg('--sg-bg-strong-rgb'),
          surface: sg('--sg-surface-rgb'),
          'surface-soft': sg('--sg-surface-soft-rgb'),
          'surface-accent': sg('--sg-surface-accent-rgb'),
          border: sg('--sg-border-rgb'),
          'border-soft': sg('--sg-border-soft-rgb'),
          text: sg('--sg-text-rgb'),
          'text-soft': sg('--sg-text-soft-rgb'),
          accent: sg('--sg-accent-rgb'),
          'accent-dark': sg('--sg-accent-dark-rgb'),
          'accent-soft': sg('--sg-accent-soft-rgb'),
          green: sg('--sg-green-rgb'),
          'green-strong': sg('--sg-green-strong-rgb'),
          'green-soft': sg('--sg-green-soft-rgb'),
          blue: sg('--sg-blue-rgb'),
          'blue-soft': sg('--sg-blue-soft-rgb'),
          amber: sg('--sg-amber-rgb'),
          'amber-soft': sg('--sg-amber-soft-rgb'),
          red: sg('--sg-red-rgb'),
          'red-soft': sg('--sg-red-soft-rgb'),
          purple: sg('--sg-purple-rgb'),
          'purple-soft': sg('--sg-purple-soft-rgb'),
        }
      },
      borderRadius: {
        'sg-sm': '8px',
        'sg-md': '12px',
        'sg-lg': '16px',
        'sg-xl': '20px',
      },
      boxShadow: {
        'sg-sm': 'var(--sg-shadow-sm)',
        'sg-md': 'var(--sg-shadow-md)',
        'sg-lg': 'var(--sg-shadow-lg)',
      },
      fontFamily: {
        sg: ['Inter', 'ui-sans-serif', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

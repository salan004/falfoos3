/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        neon: {
          cyan: '#22d3ee',
          pink: '#ff00aa',
          purple: '#7c3aed',
          green: '#00ff88',
          yellow: '#ffdd00',
          red: '#ff3355',
        },
        dark: {
          DEFAULT: '#080a12',
          panel: '#101321',
          card: '#161a2b',
          hover: '#1e2338',
        },
        arena: {
          bg: '#080a12',
          'bg-2': '#101321',
          purple: '#7c3aed',
          cyan: '#22d3ee',
          gold: '#f5c451',
          text: '#f5f7ff',
          'text-dim': '#8f96aa',
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'Tahoma', '"Noto Sans Arabic"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ["'Courier New'", 'Consolas', 'monospace'],
      },
      boxShadow: {
        neon: '0 0 10px rgba(0,240,255,0.3), 0 0 20px rgba(0,240,255,0.1)',
        'neon-pink': '0 0 10px rgba(255,0,170,0.3), 0 0 20px rgba(255,0,170,0.1)',
        'neon-green': '0 0 10px rgba(0,255,136,0.3), 0 0 20px rgba(0,255,136,0.1)',
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        pulse: 'pulse 1.5s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
      },
    },
  },
  plugins: [],
};

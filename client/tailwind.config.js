/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        neon: {
          cyan: '#00f0ff',
          pink: '#ff00aa',
          purple: '#aa00ff',
          green: '#00ff88',
          yellow: '#ffdd00',
          red: '#ff3355',
        },
        dark: {
          DEFAULT: '#0a0a0f',
          panel: '#12121a',
          card: '#1a1a2e',
          hover: '#222240',
        },
      },
      fontFamily: {
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

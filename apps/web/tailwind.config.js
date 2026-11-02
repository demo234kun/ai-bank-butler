/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0B1512',
          2: '#101C17',
          3: '#16241E',
        },
        ivory: '#F4F1EC',
        paper: '#FBFAF7',
        pine: {
          DEFAULT: '#0F3D33',
          600: '#155246',
          700: '#0C322A',
        },
        gold: {
          DEFAULT: '#C7A667',
          soft: '#E3CFA5',
          deep: '#9A7A3E',
        },
        risk: {
          green: '#2F7D5B',
          yellow: '#C9791F',
          red: '#B3392E',
        },
        muted: '#7C8B82',
      },
      fontFamily: {
        sans: ['"Microsoft YaHei"', '"PingFang SC"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', '"SFMono-Regular"', 'Consolas', 'monospace'],
        serif: ['Georgia', '"Songti SC"', '"SimSun"', 'serif'],
      },
      boxShadow: {
        phone: '0 40px 90px -20px rgba(0,0,0,.65), 0 2px 0 rgba(255,255,255,.06) inset',
        card: '0 1px 2px rgba(16,20,24,.04), 0 12px 30px -18px rgba(16,20,24,.25)',
        sheet: '0 -20px 60px -20px rgba(11,21,18,.45)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.6rem',
      },
    },
  },
  plugins: [],
};

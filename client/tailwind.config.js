/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          0: '#07111f',
          1: '#0b1630',
          2: '#112142',
        },
        panel: 'rgba(12, 20, 39, 0.88)',
        accent: {
          DEFAULT: '#47d4ff',
          strong: '#6aa7ff',
        }
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}

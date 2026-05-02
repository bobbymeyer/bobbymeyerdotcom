/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Straight Helvetica stack — system Helvetica on macOS / iOS,
        // Arial on Windows / Android, falls back to Inter (loaded via
        // Google Fonts) so Linux + Chrome OS get a tight grotesk too.
        grotesk: [
          '"Helvetica Neue"',
          'Helvetica',
          'Arial',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        paper: '#ffffff',
        ink: '#121214',
        // Swiss-poster accents
        signal: '#d4321f', // vermilion
        flag: '#f4c430',   // chrome yellow
        block: '#1a4d8c',  // print cyan
      },
    },
  },
  plugins: [],
};

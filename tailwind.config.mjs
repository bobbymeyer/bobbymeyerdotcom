/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        grotesk: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
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

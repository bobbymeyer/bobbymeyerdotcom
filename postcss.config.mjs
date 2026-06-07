// Tailwind v3 + autoprefixer via PostCSS. Astro picks this up
// automatically for all processed CSS (including src/styles/global.css,
// which keeps the @tailwind base/components/utilities directives).
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

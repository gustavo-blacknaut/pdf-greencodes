// Tailwind v4: o plugin do PostCSS mudou de pacote e o autoprefixer saiu.
// O motor novo já resolve prefixos sozinho.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

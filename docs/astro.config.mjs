import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://clarissa.run',
  trailingSlash: 'always',
  build: {
    assets: '_assets'
  }
});


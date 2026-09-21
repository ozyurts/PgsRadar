import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import { fileURLToPath } from 'node:url';

const entry = (file) => fileURLToPath(new URL(file, import.meta.url));

// vite-plugin-cesium injects Cesium's stylesheet and, in a production build, a
// blocking <script src="/cesium/Cesium.js"> into *every* HTML entry — it has no
// notion of a page that does not use the globe. Left alone, the flight tracker
// would pull several megabytes of 3D engine it never calls, on the page most
// likely to be opened on a phone over cellular data. So the tags are stripped
// from every page except the globe's own.
function cesiumOnlyOnGlobe() {
  return {
    name: 'pgsradar:cesium-only-on-globe',
    transformIndexHtml: {
      // After vite-plugin-cesium has added them, and after Vite's own tags.
      order: 'post',
      handler(html, ctx) {
        const page = ctx.path || ctx.filename || '';
        if (page.endsWith('index.html')) return html;

        return html
          .replace(/[ \t]*<script[^>]*src="[^"]*\/Cesium\.js"[^>]*><\/script>\r?\n?/g, '')
          .replace(/[ \t]*<link[^>]*href="[^"]*Widgets\/widgets\.css"[^>]*>\r?\n?/g, '');
      },
    },
  };
}

// Two pages, two entry points: the globe, and the single-flight tracker.
// Rollup only gives the tracker a bundle of its own if it is listed here.
export default defineConfig({
  plugins: [cesium(), cesiumOnlyOnGlobe()],
  build: {
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        takip: entry('./takip.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});

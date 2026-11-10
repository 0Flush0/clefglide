import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwind()],
  build: {
    license: { fileName: "THIRD_PARTY_LICENSES.md" },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "notation-fonts",
              test: /vexflow\/build\/esm\/src\/fonts\//,
              priority: 20,
            },
            {
              name: "engraving",
              test: /node_modules\/vexflow\//,
              priority: 10,
            },
            { name: "charts", test: /node_modules\/(recharts|d3-|victory-)/ },
            {
              name: "react",
              test: /node_modules\/(react|react-dom|scheduler)\//,
            },
          ],
        },
      },
    },
  },
});

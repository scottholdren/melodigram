import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/melodigram/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        workshop: resolve(__dirname, "workshop.html"),
        workshopPiano: resolve(__dirname, "workshop-piano.html"),
        drums: resolve(__dirname, "drums.html"),
        sounds: resolve(__dirname, "sounds.html"),
      },
    },
  },
});

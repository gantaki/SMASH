import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true also listens on the LAN address, so a friend on the same network can open http://<your-ip>:5173/r/CODE.
  server: { port: 5173, host: true },
  // Repo-level assets/ is served as-is: assets/sfx/x.mp3 → /sfx/x.mp3, assets/vfx/… → /vfx/….
  publicDir: "../../assets",
  // three.js alone is ~700 kB; split into chunks once there is more than one entry point.
  build: { chunkSizeWarningLimit: 1200 },
});

// @ts-ignore
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { reactRouterDevTools } from "react-router-devtools";

export default defineConfig({
  plugins: [ reactRouterDevTools(),reactRouter(), tsconfigPaths()],
});

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: [
      "@effect-atom/atom",
      "@effect-atom/atom-react",
      "effect",
      "react",
      "react-dom",
      "@tiptap/core",
      "@tiptap/pm",
    ],
  },
})

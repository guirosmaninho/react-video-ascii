import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import glsl from 'vite-plugin-glsl'

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const isUserSite = repoName?.endsWith('.github.io')
const base = process.env.PAGES_BASE_PATH
  ?? (repoName && !isUserSite ? `/${repoName}/` : '/')

export default defineConfig({
  base,
  plugins: [
    react(),
    glsl(),
  ],
})

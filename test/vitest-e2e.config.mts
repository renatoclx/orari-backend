import { fileURLToPath } from "node:url";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Raiz fixada na pasta do projeto, independente do diretório de onde o
// comando é executado.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

// Config separada para os testes e2e (sobem a aplicação NestJS completa),
// mantendo-os fora do `vitest.config.mts` usado para os testes unitários.
export default defineConfig({
  test: {
    root: projectRoot,
    include: ["test/**/*.e2e-spec.ts"],
    environment: "node",
    // Testes e2e sobem o AppModule real (incl. PrismaModule), por isso
    // precisam do .env carregado e do banco no ar (`npm run db:up`).
    setupFiles: ["dotenv/config"],
  },
  plugins: [swc.vite()],
});

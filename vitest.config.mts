import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// O NestJS depende de `emitDecoratorMetadata` para a injeção de dependência.
// O esbuild (usado por padrão pelo Vitest) não suporta essa opção, por isso
// os arquivos são transformados via SWC antes de rodar os testes.
export default defineConfig({
  test: {
    root: "./",
    include: ["src/**/*.spec.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/main.ts"],
    },
  },
  plugins: [swc.vite()],
});

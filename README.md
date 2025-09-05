# cqfx (Cornell Quant Fund Exchange) — Bootstrap

Initial repository scaffolding for the CTC exchange monorepo.

Highlights:
- pnpm workspaces + Turborepo
- FlatBuffers protocol schema with multi-language codegen
- SDK scaffolds: TypeScript, Python, Java, C++
- CI: commitlint, lint/typecheck/build, protocol codegen + compatibility guard

Local tasks:
- Install deps: `pnpm install`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Protocol ABI check: `pnpm protocol:check`
- Protocol codegen: `pnpm gen:protocol` (requires `flatc` in PATH)

Install `flatc` locally:
- macOS: `brew install flatbuffers`
- Linux: download binaries from https://github.com/google/flatbuffers/releases


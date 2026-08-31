# AGENTS.md — Repository scripts

Gate scripts invoke pnpm shell-free, normalize repository-relative glob paths to `/` at ingestion, and keep platform adaptation in the gate that needs it instead of a shared platform layer. Source-ownership gates use syntax-aware discovery, guard against an empty or narrowed corpus, and test every admitted/excluded form that changes their detection boundary.

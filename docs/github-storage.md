# GitHub Storage Layout

The repository contains the site code, importer scripts, tests, documentation,
small import summaries, and data manifests. It deliberately excludes generated
browser shards, local rollback copies, the 1GB-plus master knowledge JSON, and
raw official evidence packages.

Each verified runtime version has a private GitHub Release named
`data-v<version>`. The release stores:

- `knowledge-v<version>.json.gz`: canonical master knowledge data used to
  rebuild `site/data/knowledge-core.json` and every province shard.
- `official-provenance-v<version>.tar.gz`: raw official source evidence plus
  structured import payloads required for an offline audit.
- `runtime-release-manifest-v<version>.json`: SHA-256, sizes, model version,
  source counts, and restore instructions.

Use `node scripts/restore-runtime-from-github-release.mjs` after cloning to
download the master asset, restore the hard-linked local master, and rebuild
browser shards. The release is the immutable data layer; it does not turn a
school-official source into a province-level formal admission table.

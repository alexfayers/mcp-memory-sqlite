# mcp-memory-sqlite

## 0.0.5

### Features

- Upgraded `search_nodes` to FTS5 full-text search with BM25 relevance
  ranking
- Added `add_observations` tool for safe append-only observation updates
- Added `delete_observations` tool for removing observations by content
  match
- Added `search_related_nodes` tool for 1-hop graph traversal with
  optional entity/relation type filtering
- Refactored schema to versioned migration system with `schema_version`
  table

### Fixes

- Sanitize FTS5 query input to prevent operator injection from
  hyphens and special characters

## 0.0.4

### Patch Changes

- drop vector search improve text search with relevance ranking

## 0.0.3

### Patch Changes

- 1077dc3: optimise descriptions

## 0.0.2

### Patch Changes

- fd4a75d: address Duplicate Relations
- 9ec1806: better-sqlite3 as a onlyBuiltDependencies
- d473d7a: update search casing and error messaging
- 6e9381e: rework error messages in client

## 0.0.1

### Patch Changes

- a3ccf30: init version from mcp-memory-libsql

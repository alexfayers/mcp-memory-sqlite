# mcp-memory-sqlite

> **This repository has been superseded by [alexfayers/mcp-memory](https://github.com/alexfayers/mcp-memory)**, a full rewrite in Python. This TypeScript version is no longer maintained.

A personal knowledge graph and memory system for AI assistants using
SQLite with FTS5 full-text search. Perfect for giving Claude (or any
MCP-compatible AI) persistent memory across conversations!

> Fork of [spences10/mcp-memory-sqlite](https://github.com/spences10/mcp-memory-sqlite)
> with additional tools and FTS5 search upgrade.

## Why Use This?

Give your AI assistant a memory! This tool lets Claude (or other AI
assistants) remember entities, concepts, and their relationships
across conversations. Perfect for:

- 📚 **Personal Knowledge Management** - Build your own knowledge
  graph
- 🤖 **AI Assistant Memory** - Help Claude remember important
  information about your projects, preferences, and context
- 🔗 **Relationship Tracking** - Connect ideas, people, projects, and
  concepts
- 🔍 **Smart Text Search** - Find information using FTS5 full-text
  search with BM25 relevance ranking

## Features

- **100% Local & Private**: All your data stays on your machine
- **Easy Setup**: Works out-of-the-box with Claude Desktop
- **FTS5 Full-Text Search**: Multi-word queries with BM25 relevance
  ranking
- **Smart Deduplication**: Automatically prevents duplicate
  relationships
- **Context-Optimized**: Designed specifically for LLM context
  efficiency
- **Safe Observation Updates**: Append or delete individual
  observations without overwriting
- **Graph Traversal**: Explore 1-hop entity relationships filtered by
  type

## Quick Start

**For Claude Desktop users** (recommended):

Add this to your Claude Desktop config:

```json
{
	"mcpServers": {
		"memory": {
			"command": "npx",
			"args": ["-y", "mcp-memory-sqlite"]
		}
	}
}
```

That's it! Claude can now remember things across conversations.

## Installation

If you want to use it in your own project:

```bash
npm install mcp-memory-sqlite
# or
pnpm add mcp-memory-sqlite
```

## Configuration

**Optional**: Customize the database location with an environment
variable:

- `SQLITE_DB_PATH`: Where to store your data (default:
  `./sqlite-memory.db`)

## MCP Tools

### create_entities

Create or update entities with observations. **Note:** This overwrites
all existing observations for an entity - use `add_observations` to
append instead.

**Parameters:**

- `entities`: Array of entity objects
  - `name` (string): Unique entity identifier
  - `entityType` (string): Type/category of the entity
  - `observations` (string[]): Array of observation strings

**Example:**

```json
{
	"entities": [
		{
			"name": "Claude",
			"entityType": "AI Assistant",
			"observations": [
				"Created by Anthropic",
				"Focuses on being helpful, harmless, and honest"
			]
		}
	]
}
```

### add_observations

Append observations to an existing entity without overwriting existing
ones. Skips duplicate observations. Throws if the entity does not
exist.

**Parameters:**

- `entityName` (string): Name of the entity to update
- `observations` (string[]): Observations to add

**Example:**

```json
{
	"entityName": "Claude",
	"observations": ["Supports extended thinking mode"]
}
```

### delete_observations

Delete specific observations from an existing entity by content match.
Returns the count of deleted observations. Throws if the entity does
not exist.

**Parameters:**

- `entityName` (string): Name of the entity to update
- `observations` (string[]): Exact observation strings to delete

**Example:**

```json
{
	"entityName": "Claude",
	"observations": ["Focuses on being helpful, harmless, and honest"]
}
```

### search_nodes

Search for entities and their relations using FTS5 full-text search
with BM25 relevance ranking. Multi-word queries match terms
independently across entity names, types, and all observations.

**Parameters:**

- `query` (string): Text to search for
- `limit` (number, optional): Maximum results to return (default: 10,
  max: 50)

**Example:**

```json
{
	"query": "AI Assistant",
	"limit": 5
}
```

### read_graph

Get recent entities and their relations (returns last 10 entities by
default).

**Parameters:** None

### create_relations

Create relationships between entities. Duplicate relations (same
source, target, and type) are automatically ignored.

**Parameters:**

- `relations`: Array of relation objects
  - `source` (string): Source entity name
  - `target` (string): Target entity name
  - `type` (string): Relationship type

**Example:**

```json
{
	"relations": [
		{
			"source": "Claude",
			"target": "Anthropic",
			"type": "created_by"
		}
	]
}
```

### get_entity_with_relations

Get an entity along with all its relations and directly connected
entities.

**Parameters:**

- `name` (string): Entity name to retrieve

**Example:**

```json
{
	"name": "Claude"
}
```

### search_related_nodes

Get an entity along with all its directly related entities. Optionally
filter by entity type and/or relation type for targeted graph
traversal.

**Parameters:**

- `name` (string): Entity name to retrieve
- `entityType` (string, optional): Filter related entities by type
- `relationType` (string, optional): Filter relations by type

**Example:**

```json
{
	"name": "my-project",
	"entityType": "task",
	"relationType": "implements"
}
```

### delete_entity

Delete an entity and all associated data (observations and relations).

**Parameters:**

- `name` (string): Entity name to delete

### delete_relation

Delete a specific relation between entities.

**Parameters:**

- `source` (string): Source entity name
- `target` (string): Target entity name
- `type` (string): Relationship type

## Usage with Claude Desktop

Add to your Claude Desktop configuration:

**Minimal configuration (uses default `./sqlite-memory.db`):**

```json
{
	"mcpServers": {
		"memory": {
			"command": "npx",
			"args": ["-y", "mcp-memory-sqlite"]
		}
	}
}
```

**With custom database path:**

```json
{
	"mcpServers": {
		"memory": {
			"command": "npx",
			"args": ["-y", "mcp-memory-sqlite"],
			"env": {
				"SQLITE_DB_PATH": "/path/to/your/memory.db"
			}
		}
	}
}
```

## Database Schema

### Tables

- **entities**: Stores entity metadata (name, type, creation time)
- **observations**: Stores observations linked to entities
- **relations**: Stores relationships between entities
- **schema_version**: Tracks applied migrations
- **entities_fts**: FTS5 virtual table for full-text search (with
  sync triggers)

## Migrating from Old Single-Project Databases

If you have existing single-project memory databases (e.g., `global.db`, `project.db`), use the `alexfayers-mcp-memory-sqlite-migrate` tool to import them into the new unified multi-project database:

**Migrate global memory:**
```bash
alexfayers-mcp-memory-sqlite-migrate --source ~/.memory/global.db --project global --dest ~/.memory/memory.db
```

**Migrate project memory (run from project root):**
```bash
alexfayers-mcp-memory-sqlite-migrate --source .memory/project.db --project "$(basename "$PWD")" --dest ~/.memory/memory.db
```

The tool will:
- Create the destination DB if it doesn't exist
- Run all schema migrations automatically
- Import entities with their observations
- Import relations between entities
- Skip entities with no observations
- Deduplicate observations that already exist

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Run in development mode
pnpm run dev
```

## License

MIT

## Credits

Built with:

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Fast
  SQLite driver
- [tmcp](https://github.com/tmcp-io/tmcp) - MCP server framework

Originally by [Scott Spence](https://github.com/spences10/mcp-memory-sqlite).

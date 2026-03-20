#!/usr/bin/env node

import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { StdioTransport } from '@tmcp/transport-stdio';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { McpServer } from 'tmcp';
import { fileURLToPath } from 'url';
import * as v from 'valibot';
import { DatabaseManager } from './db/client.js';
import { get_database_config } from './db/config.js';
import { Relation } from './types/index.js';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const package_json = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
);
const { name, version } = package_json;

// Define schemas
const CreateEntitiesSchema = v.object({
	entities: v.array(
		v.object({
			name: v.string(),
			entityType: v.string(),
			observations: v.array(v.string()),
		}),
	),
});

const SearchNodesSchema = v.object({
	query: v.string(),
	limit: v.optional(v.number()),
});

const CreateRelationsSchema = v.object({
	relations: v.array(
		v.object({
			source: v.string(),
			target: v.string(),
			type: v.string(),
		}),
	),
});

const DeleteEntitySchema = v.object({
	name: v.string(),
});

const DeleteRelationSchema = v.object({
	source: v.string(),
	target: v.string(),
	type: v.string(),
});

const GetEntityWithRelationsSchema = v.object({
	name: v.string(),
});

const AddObservationsSchema = v.object({
	entityName: v.string(),
	observations: v.array(v.string()),
});

const DeleteObservationsSchema = v.object({
	entityName: v.string(),
	observations: v.array(v.string()),
});

const SearchRelatedNodesSchema = v.object({
	name: v.string(),
	entityType: v.optional(v.string()),
	relationType: v.optional(v.string()),
});

function setupTools(server: McpServer<any>, db: DatabaseManager) {
	// Tool: Create Entities
	server.tool<typeof CreateEntitiesSchema>(
		{
			name: 'create_entities',
			description: 'Create or update entities with observations',
			schema: CreateEntitiesSchema,
		},
		async ({ entities }) => {
			try {
				await db.create_entities(entities);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Successfully processed ${entities.length} entities (created new or updated existing)`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	// Tool: Search Nodes
	server.tool<typeof SearchNodesSchema>(
		{
			name: 'search_nodes',
			description:
				'Search entities and relations by text query. Returns up to limit results (default 10, max 50) ordered by relevance. Uses FTS5 full-text search with BM25 ranking - supports multi-word queries where terms match independently across name, entity_type, and observations fields.',
			schema: SearchNodesSchema,
		},
		async ({ query, limit }) => {
			try {
				const result = await db.search_nodes(query, limit);
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(result, null, 2),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	// Tool: Read Graph
	server.tool(
		{
			name: 'read_graph',
			description: 'Get recent entities and their relations',
		},
		async () => {
			try {
				const result = await db.read_graph();
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(result, null, 2),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	// Tool: Create Relations
	server.tool<typeof CreateRelationsSchema>(
		{
			name: 'create_relations',
			description: 'Create relations between entities',
			schema: CreateRelationsSchema,
		},
		async ({ relations }) => {
			try {
				// Convert to internal Relation type
				const internalRelations: Relation[] = relations.map((r) => ({
					from: r.source,
					to: r.target,
					relationType: r.type,
				}));
				await db.create_relations(internalRelations);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Created ${relations.length} relations`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	// Tool: Delete Entity
	server.tool<typeof DeleteEntitySchema>(
		{
			name: 'delete_entity',
			description: 'Delete entity and associated data',
			schema: DeleteEntitySchema,
		},
		async ({ name }) => {
			try {
				await db.delete_entity(name);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Successfully deleted entity "${name}" and its associated data`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	// Tool: Delete Relation
	server.tool<typeof DeleteRelationSchema>(
		{
			name: 'delete_relation',
			description: 'Delete relation between entities',
			schema: DeleteRelationSchema,
		},
		async ({ source, target, type }) => {
			try {
				await db.delete_relation(source, target, type);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Successfully deleted relation: ${source} -> ${target} (${type})`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	// Tool: Get Entity With Relations
	server.tool<typeof GetEntityWithRelationsSchema>(
		{
			name: 'get_entity_with_relations',
			description:
				'Get an entity along with all its relations and related entities. Useful for exploring the knowledge graph around a specific entity.',
			schema: GetEntityWithRelationsSchema,
		},
		async ({ name }) => {
			try {
				const result = await db.get_entity_with_relations(name);
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(result, null, 2),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	// Tool: Add Observations
	server.tool<typeof AddObservationsSchema>(
		{
			name: 'add_observations',
			description:
				'Append observations to an existing entity without overwriting existing ones. Skips duplicate observations. Throws if the entity does not exist.',
			schema: AddObservationsSchema,
		},
		async ({ entityName, observations }) => {
			try {
				const added = await db.add_observations(entityName, observations);
				const skipped = observations.length - added;
				return {
					content: [
						{
							type: 'text' as const,
							text: `Added ${added} observations to entity "${entityName}"${skipped > 0 ? ` (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)` : ''}`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	// Tool: Delete Observations
	server.tool<typeof DeleteObservationsSchema>(
		{
			name: 'delete_observations',
			description:
				'Delete specific observations from an existing entity by content match. Returns the count of deleted observations. Throws if the entity does not exist.',
			schema: DeleteObservationsSchema,
		},
		async ({ entityName, observations }) => {
			try {
				const deleted = await db.delete_observations(entityName, observations);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Deleted ${deleted} observation${deleted === 1 ? '' : 's'} from entity "${entityName}"`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	// Tool: Search Related Nodes
	server.tool<typeof SearchRelatedNodesSchema>(
		{
			name: 'search_related_nodes',
			description:
				'Get an entity along with all its directly related entities. Optionally filter by entityType (e.g. "task") and/or relationType (e.g. "implements").',
			schema: SearchRelatedNodesSchema,
		},
		async ({ name, entityType, relationType }) => {
			try {
				const result = await db.search_related_nodes(
					name,
					entityType,
					relationType,
				);
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(result, null, 2),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'internal_error',
									message:
										error instanceof Error
											? error.message
											: 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);
}

// Start the server
async function main() {
	// Initialize database
	const config = get_database_config();
	const db = await DatabaseManager.get_instance(config);

	// Create tmcp server with Valibot adapter
	const adapter = new ValibotJsonSchemaAdapter();
	const server = new McpServer<any>(
		{
			name,
			version,
			description:
				'SQLite-based persistent memory tool for MCP with text search',
		},
		{
			adapter,
			capabilities: {
				tools: { listChanged: true },
			},
		},
	);

	// Setup tool handlers
	setupTools(server, db);

	// Error handling and graceful shutdown
	process.on('SIGINT', async () => {
		await db?.close();
		process.exit(0);
	});

	const transport = new StdioTransport(server);
	transport.listen();
	console.error(`SQLite Memory MCP server running on stdio (${config.dbPath})`);
}

main().catch(console.error);

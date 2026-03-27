#!/usr/bin/env node

import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { HttpTransport } from '@tmcp/transport-http';
import { createServer } from 'node:http';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { McpServer } from 'tmcp';
import { fileURLToPath } from 'url';
import * as v from 'valibot';
import { DatabaseManager } from './db/client.js';
import { get_database_config } from './db/config.js';
import { EntityStatus, Relation } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const package_json = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
);
const { name, version } = package_json;

const RELATION_EXEMPT_TYPES = new Set(['user-preferences', 'pattern']);

const ENTITY_NAMING_GUIDE = `
Entity naming conventions (prefix with entity type to avoid collisions):
- project/<repo-name> (e.g. project/MyRepo)
- feature/<project>/<area> (e.g. feature/MyRepo/auth)
- task/<TICKET-ID>-<slug> (e.g. task/ABC-123-fix-login)
- user-preferences/<alias>-<topic> (e.g. user-preferences/alice-workflow)
- pattern/<short-noun> (e.g. pattern/retry-logic)
- changelog/<TICKET-ID>-<slug> or changelog/<project>-<date>-<slug>`.trim();

const VALID_STATUSES = ['planned', 'in-progress', 'blocked', 'resolved', 'archived'] as const;
const StatusSchema = v.optional(v.nullable(v.picklist(VALID_STATUSES)));

const CreateEntitiesSchema = v.object({
	project: v.string(),
	entities: v.array(
		v.object({
			name: v.string(),
			entityType: v.string(),
			observations: v.array(v.string()),
			status: StatusSchema,
			relations: v.optional(
				v.array(
					v.object({
						source: v.string(),
						target: v.string(),
						type: v.string(),
					}),
				),
			),
		}),
	),
});

const SearchNodesSchema = v.object({
	project: v.string(),
	query: v.string(),
	limit: v.optional(v.number()),
	entityType: v.optional(v.string()),
	status: v.optional(v.picklist(VALID_STATUSES)),
});

const ReadGraphSchema = v.object({
	project: v.string(),
	status: v.optional(v.picklist(VALID_STATUSES)),
});

const SetEntityStatusSchema = v.object({
	project: v.string(),
	name: v.string(),
	status: v.nullable(v.picklist(VALID_STATUSES)),
});

const CreateRelationsSchema = v.object({
	project: v.string(),
	relations: v.array(
		v.object({
			source: v.string(),
			target: v.string(),
			type: v.string(),
		}),
	),
});

const DeleteEntitySchema = v.object({
	project: v.string(),
	name: v.string(),
});

const DeleteRelationSchema = v.object({
	project: v.string(),
	source: v.string(),
	target: v.string(),
	type: v.string(),
});

const GetEntityWithRelationsSchema = v.object({
	project: v.string(),
	name: v.string(),
});

const AddObservationsSchema = v.object({
	project: v.string(),
	entityName: v.string(),
	observations: v.array(v.string()),
});

const DeleteObservationsSchema = v.object({
	project: v.string(),
	entityName: v.string(),
	observations: v.array(v.string()),
});

const SearchRelatedNodesSchema = v.object({
	project: v.string(),
	name: v.string(),
	entityType: v.optional(v.string()),
	relationType: v.optional(v.string()),
});

function make_error_response(error: unknown) {
	return {
		content: [
			{
				type: 'text' as const,
				text: JSON.stringify(
					{
						error: 'internal_error',
						message: error instanceof Error ? error.message : 'Unknown error',
					},
					null,
					2,
				),
			},
		],
		isError: true,
	};
}

function setupTools(server: McpServer<any>, db: DatabaseManager) {
	server.tool<typeof CreateEntitiesSchema>(
		{
			name: 'create_entities',
			description: `Create or update entities with observations in the knowledge graph. All data is scoped to the given project string.

RELATION REQUIREMENT: For entity types that require relations (anything except "user-preferences" and "pattern"), you MUST supply at least one relation per entity via the entity's inline relations field (array of {source, target, type} objects). This is enforced server-side.

OBSERVATION RULES:
- project/feature entities: use present tense for current facts
- task/changelog entities: use past tense for completed actions
- Each observation must be atomic - one fact per observation
- create_entities OVERWRITES all existing observations - use add_observations to append safely

${ENTITY_NAMING_GUIDE}

TASK ENTITY DISCIPLINE:
- Every task/ entity MUST include a STATUS: observation: "STATUS: in-progress", "STATUS: blocked", or "STATUS: complete"
- Task entities MUST be linked to their parent project with a belongs-to relation
- CRITICAL: Always call create_relations after create_entities - relations are the core of the graph

RELATION TYPES: task implements feature, task belongs-to project, feature belongs-to project, pattern used-in project, changelog modified project, changelog follows changelog`,
			schema: CreateEntitiesSchema,
		},
		async ({ project, entities }) => {
			try {
				for (const entity of entities) {
					if (
						!RELATION_EXEMPT_TYPES.has(entity.entityType) &&
						(!entity.relations || entity.relations.length === 0)
					) {
						throw new Error(
							`Entity "${entity.name}" of type "${entity.entityType}" requires at least one relation. ` +
								`Only "user-preferences" and "pattern" entities are exempt. ` +
								`Provide relations in the entity's "relations" field.`,
						);
					}
				}
				const allRelations: Relation[] = entities
					.flatMap((e) => e.relations ?? [])
					.map((r) => ({ from: r.source, to: r.target, relationType: r.type }));
				await db.create_entities(project, entities);
				if (allRelations.length > 0) {
					await db.create_relations(project, allRelations);
				}
				return {
					content: [
						{
							type: 'text' as const,
							text: `Successfully processed ${entities.length} entities (created new or updated existing)`,
						},
					],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof SearchNodesSchema>(
		{
			name: 'search_nodes',
			description: `Search entities and relations by text query within the given project. Returns up to limit results (default 10, max 50) ordered by relevance. Uses FTS5 full-text search with BM25 ranking - supports multi-word queries where terms match independently across name, entity_type, and observations fields. Optionally filter results to a specific entityType (e.g. "task").

USAGE GUIDANCE:
- Search for keywords from the user's message (e.g. file names, feature names, ticket IDs)
- Always search for "user-preferences" to find workflow and coding style rules
- Always search for "STATUS in-progress" to find any unfinished task entities
- Search for relevant pattern/ entities related to tools/services being used
- Multi-word queries match terms independently (OR semantics with BM25 ranking)`,
			schema: SearchNodesSchema,
		},
		async ({ project, query, limit, entityType, status }) => {
			try {
				const result = await db.search_nodes(project, query, limit, entityType, status as EntityStatus | undefined);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof ReadGraphSchema>(
		{
			name: 'read_graph',
			description: `Get the most recent entities and their relations for the given project. Returns up to 10 recent entities. Use this as a starting point to discover what is already known - call this first before any task, then use search_nodes and get_entity_with_relations for deeper context.`,
			schema: ReadGraphSchema,
		},
		async ({ project, status }) => {
			try {
				const result = await db.read_graph(project, status as EntityStatus | undefined);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof CreateRelationsSchema>(
		{
			name: 'create_relations',
			description: `Create relations between entities in the given project. Relations are the core of the graph model - entities without relations are nearly useless.

CRITICAL: You MUST call create_relations whenever you call create_entities. Always link new entities to existing ones.

Every entity MUST have at least one relation, except user-preferences and pattern entities (global singletons not tied to a specific project).

STANDARD RELATION TYPES:
- task implements feature
- task belongs-to project
- feature belongs-to project
- pattern used-in project
- changelog modified project or feature
- changelog follows <previous changelog> (chain chronological changes for full history traversal)`,
			schema: CreateRelationsSchema,
		},
		async ({ project, relations }) => {
			try {
				const internalRelations: Relation[] = relations.map((r) => ({
					from: r.source,
					to: r.target,
					relationType: r.type,
				}));
				await db.create_relations(project, internalRelations);
				return {
					content: [{ type: 'text' as const, text: `Created ${relations.length} relations` }],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof DeleteEntitySchema>(
		{
			name: 'delete_entity',
			description: `Delete an entity and all its associated observations and relations from the given project. Use sparingly - prefer marking things deprecated in observations unless the memory would actively mislead future sessions.`,
			schema: DeleteEntitySchema,
		},
		async ({ project, name }) => {
			try {
				await db.delete_entity(project, name);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Successfully deleted entity "${name}" and its associated data`,
						},
					],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof DeleteRelationSchema>(
		{
			name: 'delete_relation',
			description: `Delete a specific relation between two entities in the given project. Use sparingly - only remove relations that are incorrect or no longer relevant.`,
			schema: DeleteRelationSchema,
		},
		async ({ project, source, target, type }) => {
			try {
				await db.delete_relation(project, source, target, type);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Successfully deleted relation: ${source} -> ${target} (${type})`,
						},
					],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof GetEntityWithRelationsSchema>(
		{
			name: 'get_entity_with_relations',
			description: `Get an entity along with all its relations and related entities within the given project. Useful for exploring the knowledge graph around a specific entity - traverses the graph to discover linked context that search alone would miss.

USAGE: Call this on every relevant entity found via search_nodes or read_graph. This is how you discover connected context that plain search misses. Also use search_related_nodes(name="project/<current-project>", entityType="task") to find all task entities for a project.`,
			schema: GetEntityWithRelationsSchema,
		},
		async ({ project, name }) => {
			try {
				const result = await db.get_entity_with_relations(project, name);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof AddObservationsSchema>(
		{
			name: 'add_observations',
			description: `Append observations to an existing entity without overwriting existing ones. Skips duplicate observations. Throws if the entity does not exist.

PREFER THIS OVER create_entities when you only want to add new facts. create_entities OVERWRITES all observations; add_observations safely appends.

OBSERVATION BEST PRACTICES:
- Each observation must be atomic - one fact per observation
- project/feature entities: use present tense for current facts
- task/changelog entities: use past tense for completed actions
- Do not include rationale in the same observation as the fact - add a separate observation for "why"
- Prefer small, precise observations over long narrative text`,
			schema: AddObservationsSchema,
		},
		async ({ project, entityName, observations }) => {
			try {
				const added = await db.add_observations(project, entityName, observations);
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
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof DeleteObservationsSchema>(
		{
			name: 'delete_observations',
			description: `Delete specific observations from an existing entity by exact content match. Returns the count of deleted observations. Throws if the entity does not exist.

Use this to correct outdated or incorrect facts. The match is exact - provide the observation string exactly as stored.`,
			schema: DeleteObservationsSchema,
		},
		async ({ project, entityName, observations }) => {
			try {
				const deleted = await db.delete_observations(project, entityName, observations);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Deleted ${deleted} observation${deleted === 1 ? '' : 's'} from entity "${entityName}"`,
						},
					],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof SetEntityStatusSchema>(
		{
			name: 'set_entity_status',
			description: `Set or clear the status of an entity. Use null to remove lifecycle tracking from an entity.

Valid statuses: planned, in-progress, blocked, resolved, archived
- planned: work is queued but not started
- in-progress: actively being worked on
- blocked: waiting on an external dependency
- resolved: work is complete
- archived: no longer relevant but preserved for history

Use this instead of STATUS: observation text when you want structured, filterable lifecycle state.`,
			schema: SetEntityStatusSchema,
		},
		async ({ project, name, status }) => {
			try {
				await db.set_entity_status(project, name, status as EntityStatus | null);
				const statusText = status ?? 'null (cleared)';
				return {
					content: [
						{
							type: 'text' as const,
							text: `Set status of "${name}" to ${statusText}`,
						},
					],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);

	server.tool<typeof SearchRelatedNodesSchema>(
		{
			name: 'search_related_nodes',
			description: `Get an entity along with all its directly related entities within the given project. Optionally filter by entityType (e.g. "task") and/or relationType (e.g. "implements").

KEY USE CASE: Call search_related_nodes(project=..., name="project/<current-project>", entityType="task") to find ALL task entities for a project - this is the most reliable way to discover in-progress work.

Relations are traversed at 1-hop depth. Use get_entity_with_relations for full relation details including the related entity data.`,
			schema: SearchRelatedNodesSchema,
		},
		async ({ project, name, entityType, relationType }) => {
			try {
				const result = await db.search_related_nodes(
					project,
					name,
					entityType,
					relationType,
				);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				return make_error_response(error);
			}
		},
	);
}

async function main() {
	const config = get_database_config();
	const db = await DatabaseManager.get_instance(config);

	const adapter = new ValibotJsonSchemaAdapter();
	const server = new McpServer<any>(
		{
			name,
			version,
			description: 'SQLite-based persistent memory tool for MCP with text search and project scoping',
		},
		{
			adapter,
			capabilities: {
				tools: { listChanged: true },
			},
		},
	);

	setupTools(server, db);

	process.on('SIGINT', async () => {
		await db?.close();
		process.exit(0);
	});

	const port = parseInt(process.env.MCP_PORT ?? '3000', 10);
	const http_transport = new HttpTransport(server, { path: '/mcp', cors: true });

	const http_server = createServer(async (req, res) => {
		const url = `http://localhost:${port}${req.url}`;
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries(req.headers)) {
			if (typeof value === 'string') {
				headers[key] = value;
			} else if (Array.isArray(value)) {
				headers[key] = value.join(', ');
			}
		}

		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

		const fetch_request = new Request(url, {
			method: req.method,
			headers,
			body: body && body.length > 0 ? body : undefined,
		});

		const fetch_response = await http_transport.respond(fetch_request);

		if (!fetch_response) {
			res.writeHead(404);
			res.end();
			return;
		}

		res.writeHead(fetch_response.status, Object.fromEntries(fetch_response.headers.entries()));
		res.flushHeaders();

		if (fetch_response.body) {
			const reader = fetch_response.body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				res.write(value);
			}
		}

		res.end();
	});

	process.on('SIGINT', () => http_server.close());

	http_server.listen(port, () => {
		console.error(`[${new Date().toISOString()}] SQLite Memory MCP server running on http://localhost:${port}/mcp (${config.dbPath})`);
	});
}

main().catch(console.error);

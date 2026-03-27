import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { run_migrations } from './migrations/run.js';
import { Entity, Relation, SearchResult } from '../types/index.js';

interface DatabaseConfig {
	dbPath: string;
}

export class DatabaseManager {
	private static instance: DatabaseManager;
	private db: Database.Database;

	private constructor(config: DatabaseConfig) {
		if (!config.dbPath) {
			throw new Error('Database path is required');
		}

		mkdirSync(dirname(config.dbPath), { recursive: true });
		this.db = new Database(config.dbPath);

		this.db.pragma('journal_mode = WAL');
		this.db.pragma('synchronous = NORMAL');
		this.db.pragma('cache_size = 1000');
		this.db.pragma('temp_store = MEMORY');
	}

	public static async get_instance(
		config: DatabaseConfig,
	): Promise<DatabaseManager> {
		if (!DatabaseManager.instance) {
			DatabaseManager.instance = new DatabaseManager(config);
			await DatabaseManager.instance.initialize();
		}
		return DatabaseManager.instance;
	}

	private get_or_create_project_id(project: string): number {
		this.db
			.prepare('INSERT OR IGNORE INTO projects (name) VALUES (?)')
			.run(project);
		const row = this.db
			.prepare('SELECT id FROM projects WHERE name = ?')
			.get(project) as { id: number };
		return row.id;
	}

	private get_or_create_entity_type_id(entityType: string): number {
		this.db
			.prepare('INSERT OR IGNORE INTO entity_types (name) VALUES (?)')
			.run(entityType);
		const row = this.db
			.prepare('SELECT id FROM entity_types WHERE name = ?')
			.get(entityType) as { id: number };
		return row.id;
	}

	private get_or_create_relation_type_id(relationType: string): number {
		this.db
			.prepare('INSERT OR IGNORE INTO relation_types (name) VALUES (?)')
			.run(relationType);
		const row = this.db
			.prepare('SELECT id FROM relation_types WHERE name = ?')
			.get(relationType) as { id: number };
		return row.id;
	}

	private get_entity_id(name: string, projectId: number): number | undefined {
		const row = this.db
			.prepare('SELECT id FROM entities WHERE name = ? AND project_id = ?')
			.get(name, projectId) as { id: number } | undefined;
		return row?.id;
	}

	private get_entity_row(
		id: number,
	): { id: number; name: string; entity_type: string; project_id: number } | undefined {
		return this.db
			.prepare(
				`SELECT e.id, e.name, t.name AS entity_type, e.project_id
				FROM entities e
				JOIN entity_types t ON t.id = e.entity_type_id
				WHERE e.id = ?`,
			)
			.get(id) as
			| { id: number; name: string; entity_type: string; project_id: number }
			| undefined;
	}

	private get_observations_by_id(entityId: number): string[] {
		const rows = this.db
			.prepare('SELECT content FROM observations WHERE entity_id = ?')
			.all(entityId) as Array<{ content: string }>;
		return rows.map((r) => r.content);
	}

	async create_entities(
		project: string,
		entities: Array<{
			name: string;
			entityType: string;
			observations: string[];
		}>,
	): Promise<void> {
		const transaction = this.db.transaction(() => {
			const projectId = this.get_or_create_project_id(project);

			for (const entity of entities) {
				if (
					!entity.name ||
					typeof entity.name !== 'string' ||
					entity.name.trim() === ''
				) {
					throw new Error('Entity name must be a non-empty string');
				}

				if (
					!entity.entityType ||
					typeof entity.entityType !== 'string' ||
					entity.entityType.trim() === ''
				) {
					throw new Error(
						`Invalid entity type for entity "${entity.name}"`,
					);
				}

				if (
					!Array.isArray(entity.observations) ||
					entity.observations.length === 0
				) {
					throw new Error(
						`Entity "${entity.name}" must have at least one observation`,
					);
				}

				if (
					!entity.observations.every(
						(obs) => typeof obs === 'string' && obs.trim() !== '',
					)
				) {
					throw new Error(
						`Entity "${entity.name}" has invalid observations. All observations must be non-empty strings`,
					);
				}

				let entityId = this.get_entity_id(entity.name, projectId);
				const entityTypeId = this.get_or_create_entity_type_id(entity.entityType);

				if (entityId !== undefined) {
					this.db
						.prepare(
							'UPDATE entities SET entity_type_id = ? WHERE id = ?',
						)
						.run(entityTypeId, entityId);
				} else {
					const result = this.db
						.prepare(
							'INSERT INTO entities (name, entity_type_id, project_id) VALUES (?, ?, ?)',
						)
						.run(entity.name, entityTypeId, projectId);
					entityId = result.lastInsertRowid as number;
				}

				this.db
					.prepare('DELETE FROM observations WHERE entity_id = ?')
					.run(entityId);

				const insert_obs = this.db.prepare(
					'INSERT INTO observations (entity_id, content) VALUES (?, ?)',
				);
				for (const observation of entity.observations) {
					insert_obs.run(entityId, observation);
				}
			}
		});

		try {
			transaction();
		} catch (error) {
			throw new Error(
				`Entity operation failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	async add_observations(
		project: string,
		entityName: string,
		observations: string[],
	): Promise<number> {
		try {
			const projectId = this.get_or_create_project_id(project);
			const entityId = this.get_entity_id(entityName, projectId);

			if (entityId === undefined) {
				throw new Error(`Entity not found: ${entityName}`);
			}

			const existing_obs = this.db
				.prepare('SELECT content FROM observations WHERE entity_id = ?')
				.all(entityId) as Array<{ content: string }>;

			const existing_set = new Set(existing_obs.map((r) => r.content));
			const new_observations = observations.filter(
				(o) => !existing_set.has(o),
			);

			if (new_observations.length > 0) {
				const insert = this.db.prepare(
					'INSERT INTO observations (entity_id, content) VALUES (?, ?)',
				);
				const insert_all = this.db.transaction(() => {
					for (const obs of new_observations) {
						insert.run(entityId, obs);
					}
				});
				insert_all();
			}

			return new_observations.length;
		} catch (error) {
			throw new Error(
				`Failed to add observations to "${entityName}": ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	async delete_observations(
		project: string,
		entityName: string,
		observations: string[],
	): Promise<number> {
		try {
			const projectId = this.get_or_create_project_id(project);
			const entityId = this.get_entity_id(entityName, projectId);

			if (entityId === undefined) {
				throw new Error(`Entity not found: ${entityName}`);
			}

			let deleted = 0;
			const delete_obs = this.db.transaction(() => {
				for (const obs of observations) {
					const result = this.db
						.prepare(
							'DELETE FROM observations WHERE entity_id = ? AND content = ?',
						)
						.run(entityId, obs);
					deleted += result.changes;
				}
			});
			delete_obs();

			return deleted;
		} catch (error) {
			throw new Error(
				`Failed to delete observations from "${entityName}": ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	async get_entity(project: string, name: string): Promise<Entity> {
		const projectId = this.get_or_create_project_id(project);
		const entityId = this.get_entity_id(name, projectId);

		if (entityId === undefined) {
			throw new Error(`Entity not found: ${name}`);
		}

		const row = this.get_entity_row(entityId)!;

		return {
			name: row.name,
			entityType: row.entity_type,
			observations: this.get_observations_by_id(entityId),
		};
	}

	private sanitize_fts_query(query: string): string {
		return query
			.trim()
			.split(/\s+/)
			.map((token) => `"${token.replace(/"/g, '""')}"`)
			.join(' ');
	}

	async search_entities(
		project: string,
		query: string,
		limit: number = 10,
		entityType?: string,
	): Promise<Entity[]> {
		const effective_limit = Math.min(Math.max(1, limit), 50);
		const type_filter = entityType ? ' AND t.name = ?' : '';

		const params: unknown[] = [this.sanitize_fts_query(query), project];
		if (entityType) params.push(entityType);
		params.push(effective_limit);

		const results = this.db
			.prepare(
				`
        SELECT e.id, e.name, t.name AS entity_type
        FROM entities_fts
        JOIN entities e ON entities_fts.rowid = e.id
        JOIN entity_types t ON t.id = e.entity_type_id
        JOIN projects p ON p.id = e.project_id
        WHERE entities_fts MATCH ? AND p.name = ?${type_filter}
        ORDER BY bm25(entities_fts)
        LIMIT ?
      `,
			)
			.all(...params) as Array<{
			id: number;
			name: string;
			entity_type: string;
		}>;

		return results.map((row) => ({
			name: row.name,
			entityType: row.entity_type,
			observations: this.get_observations_by_id(row.id),
		}));
	}

	async get_recent_entities(project: string, limit = 10): Promise<Entity[]> {
		const results = this.db
			.prepare(
				`SELECT e.id, e.name, t.name AS entity_type
				FROM entities e
				JOIN entity_types t ON t.id = e.entity_type_id
				JOIN projects p ON p.id = e.project_id
				WHERE p.name = ?
				ORDER BY e.created_at DESC
				LIMIT ?`,
			)
			.all(project, limit) as Array<{ id: number; name: string; entity_type: string }>;

		return results.map((row) => ({
			name: row.name,
			entityType: row.entity_type,
			observations: this.get_observations_by_id(row.id),
		}));
	}

	async create_relations(project: string, relations: Relation[]): Promise<void> {
		try {
			if (relations.length === 0) return;

			const transaction = this.db.transaction(() => {
				const projectId = this.get_or_create_project_id(project);
				const insert = this.db.prepare(
					'INSERT OR IGNORE INTO relations (source_id, target_id, relation_type_id) VALUES (?, ?, ?)',
				);
				for (const relation of relations) {
					const sourceId = this.get_entity_id(relation.from, projectId);
					const targetId = this.get_entity_id(relation.to, projectId);
					const relationTypeId = this.get_or_create_relation_type_id(relation.relationType);

					if (sourceId === undefined) {
						throw new Error(
							`Source entity not found: ${relation.from}`,
						);
					}
					if (targetId === undefined) {
						throw new Error(
							`Target entity not found: ${relation.to}`,
						);
					}

					insert.run(sourceId, targetId, relationTypeId);
				}
			});

			transaction();
		} catch (error) {
			throw new Error(
				`Failed to create relations: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	async delete_entity(project: string, name: string): Promise<void> {
		try {
			const projectId = this.get_or_create_project_id(project);
			const entityId = this.get_entity_id(name, projectId);

			if (entityId === undefined) {
				throw new Error(`Entity not found: ${name}`);
			}

			const transaction = this.db.transaction(() => {
				this.db
					.prepare('DELETE FROM observations WHERE entity_id = ?')
					.run(entityId);

				this.db
					.prepare(
						'DELETE FROM relations WHERE source_id = ? OR target_id = ?',
					)
					.run(entityId, entityId);

				this.db
					.prepare('DELETE FROM entities WHERE id = ?')
					.run(entityId);
			});

			transaction();
		} catch (error) {
			throw new Error(
				`Failed to delete entity "${name}": ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	async delete_relation(
		project: string,
		source: string,
		target: string,
		type: string,
	): Promise<void> {
		try {
			const projectId = this.get_or_create_project_id(project);
			const sourceId = this.get_entity_id(source, projectId);
			const targetId = this.get_entity_id(target, projectId);

			if (sourceId === undefined || targetId === undefined) {
				throw new Error(
					`Relation not found: ${source} -> ${target} (${type})`,
				);
			}

			const relationTypeId = this.db
				.prepare('SELECT id FROM relation_types WHERE name = ?')
				.get(type) as { id: number } | undefined;

			if (!relationTypeId) {
				throw new Error(
					`Relation not found: ${source} -> ${target} (${type})`,
				);
			}

			const result = this.db
				.prepare(
					'DELETE FROM relations WHERE source_id = ? AND target_id = ? AND relation_type_id = ?',
				)
				.run(sourceId, targetId, relationTypeId.id);

			if (result.changes === 0) {
				throw new Error(
					`Relation not found: ${source} -> ${target} (${type})`,
				);
			}
		} catch (error) {
			throw new Error(
				`Failed to delete relation: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	async get_relations_for_entities(
		project: string,
		entities: Entity[],
	): Promise<Relation[]> {
		if (entities.length === 0) return [];

		const projectId = this.get_or_create_project_id(project);
		const ids = entities
			.map((e) => this.get_entity_id(e.name, projectId))
			.filter((id): id is number => id !== undefined);

		if (ids.length === 0) return [];

		const placeholders = ids.map(() => '?').join(',');

		const results = this.db
			.prepare(
				`
        SELECT es.name AS from_entity, et.name AS to_entity, rt.name AS relation_type
        FROM relations r
        JOIN entities es ON es.id = r.source_id
        JOIN entities et ON et.id = r.target_id
        JOIN relation_types rt ON rt.id = r.relation_type_id
        WHERE r.source_id IN (${placeholders})
        OR r.target_id IN (${placeholders})
      `,
			)
			.all(...ids, ...ids) as Array<{
			from_entity: string;
			to_entity: string;
			relation_type: string;
		}>;

		return results.map((row) => ({
			from: row.from_entity,
			to: row.to_entity,
			relationType: row.relation_type,
		}));
	}

	async get_entity_with_relations(
		project: string,
		name: string,
	): Promise<{ entity: Entity; relations: Relation[]; relatedEntities: Entity[] }> {
		const entity = await this.get_entity(project, name);
		const relations = await this.get_relations_for_entities(project, [entity]);

		const related_names = new Set<string>();
		for (const rel of relations) {
			if (rel.from !== name) related_names.add(rel.from);
			if (rel.to !== name) related_names.add(rel.to);
		}

		const relatedEntities: Entity[] = [];
		for (const related_name of related_names) {
			try {
				const related_entity = await this.get_entity(project, related_name);
				relatedEntities.push(related_entity);
			} catch (error) {
				console.warn(
					`[${new Date().toISOString()}] Related entity "${related_name}" not found: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}

		return { entity, relations, relatedEntities };
	}

	async search_related_nodes(
		project: string,
		name: string,
		entityType?: string,
		relationType?: string,
	): Promise<{ entity: Entity; relations: Relation[]; relatedEntities: Entity[] }> {
		const entity = await this.get_entity(project, name);
		let relations = await this.get_relations_for_entities(project, [entity]);

		if (relationType) {
			relations = relations.filter((r) => r.relationType === relationType);
		}

		const related_names = new Set<string>();
		for (const rel of relations) {
			if (rel.from !== name) related_names.add(rel.from);
			if (rel.to !== name) related_names.add(rel.to);
		}

		const relatedEntities: Entity[] = [];
		for (const related_name of related_names) {
			try {
				const related_entity = await this.get_entity(project, related_name);
				if (!entityType || related_entity.entityType === entityType) {
					relatedEntities.push(related_entity);
				}
			} catch {
				// Skip entities that no longer exist
			}
		}

		return { entity, relations, relatedEntities };
	}

	async read_graph(project: string): Promise<{
		entities: Entity[];
		relations: Relation[];
	}> {
		const recent_entities = await this.get_recent_entities(project);
		const relations = await this.get_relations_for_entities(project, recent_entities);
		return { entities: recent_entities, relations };
	}

	async search_nodes(
		project: string,
		query: string,
		limit: number = 10,
		entityType?: string,
	): Promise<{ entities: Entity[]; relations: Relation[] }> {
		try {
			if (typeof query !== 'string') {
				throw new Error('Text query must be a string');
			}
			if (query.trim() === '') {
				throw new Error('Text query cannot be empty');
			}

			const entities = await this.search_entities(project, query, limit, entityType);

			if (entities.length === 0) {
				return { entities: [], relations: [] };
			}

			const relations = await this.get_relations_for_entities(project, entities);
			return { entities, relations };
		} catch (error) {
			throw new Error(
				`Node search failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	public get_client() {
		return this.db;
	}

	public async initialize() {
		try {
			run_migrations(this.db);
		} catch (error) {
			throw new Error(
				`Database initialization failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	public async close() {
		try {
			this.db.close();
		} catch (error) {
			console.error(`[${new Date().toISOString()}] Error closing database connection:`, error);
		}
	}
}

export type { DatabaseConfig };

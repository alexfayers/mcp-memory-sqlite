#!/usr/bin/env node

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { run_migrations } from './db/migrations/run.js';

const { values } = parseArgs({
	options: {
		source: { type: 'string' },
		project: { type: 'string' },
		dest: { type: 'string' },
	},
});

if (!values.source || !values.project || !values.dest) {
	console.error(`[${new Date().toISOString()}] Usage: migrate-import --source <old-db> --project <project-name> --dest <unified-db>`);
	process.exit(1);
}

async function main() {
	const source_db = new Database(values.source as string);
	source_db.pragma('journal_mode = WAL');
	source_db.pragma('foreign_keys = OFF');

	console.log(`[${new Date().toISOString()}] Running migrations on source DB...`);
	run_migrations(source_db);
	source_db.pragma('foreign_keys = OFF');

	const entities = source_db
		.prepare(
			`SELECT e.id, e.name, t.name AS entity_type
			FROM entities e
			JOIN entity_types t ON t.id = e.entity_type_id
			JOIN projects p ON p.id = e.project_id`,
		)
		.all() as Array<{ id: number; name: string; entity_type: string }>;

	mkdirSync(dirname(values.dest as string), { recursive: true });
	const dest_db = new Database(values.dest as string);
	dest_db.pragma('journal_mode = WAL');
	dest_db.pragma('foreign_keys = OFF');

	run_migrations(dest_db);
	dest_db.pragma('foreign_keys = OFF');

	let entity_count = 0;
	let relation_count = 0;
	let skipped = 0;

	const transaction = dest_db.transaction(() => {
		for (const entity of entities) {
			const observations = source_db
				.prepare('SELECT content FROM observations WHERE entity_id = ?')
				.all(entity.id) as Array<{ content: string }>;

			if (observations.length === 0) {
				skipped++;
				continue;
			}

			dest_db
				.prepare('INSERT OR IGNORE INTO projects (name) VALUES (?)')
				.run(values.project as string);
			const project_row = dest_db
				.prepare('SELECT id FROM projects WHERE name = ?')
				.get(values.project as string) as { id: number };

			dest_db
				.prepare('INSERT OR IGNORE INTO entity_types (name) VALUES (?)')
				.run(entity.entity_type);
			const type_row = dest_db
				.prepare('SELECT id FROM entity_types WHERE name = ?')
				.get(entity.entity_type) as { id: number };

			const existing = dest_db
				.prepare('SELECT id FROM entities WHERE name = ? AND project_id = ?')
				.get(entity.name, project_row.id) as { id: number } | undefined;

			let dest_entity_id: number;
			if (existing) {
				dest_entity_id = existing.id;
			} else {
				const result = dest_db
					.prepare('INSERT INTO entities (name, entity_type_id, project_id) VALUES (?, ?, ?)')
					.run(entity.name, type_row.id, project_row.id);
				dest_entity_id = result.lastInsertRowid as number;
				entity_count++;
			}

			const existing_obs = new Set(
				(dest_db
					.prepare('SELECT content FROM observations WHERE entity_id = ?')
					.all(dest_entity_id) as Array<{ content: string }>).map((r) => r.content),
			);

			const insert_obs = dest_db.prepare(
				'INSERT INTO observations (entity_id, content) VALUES (?, ?)',
			);
			for (const obs of observations) {
				if (!existing_obs.has(obs.content)) {
					insert_obs.run(dest_entity_id, obs.content);
				}
			}
		}

		const relations = source_db
			.prepare(
				`SELECT es.name AS source, et.name AS target, rt.name AS relation_type
				FROM relations r
				JOIN entities es ON es.id = r.source_id
				JOIN entities et ON et.id = r.target_id
				JOIN relation_types rt ON rt.id = r.relation_type_id`,
			)
			.all() as Array<{ source: string; target: string; relation_type: string }>;

		const project_row = dest_db
			.prepare('SELECT id FROM projects WHERE name = ?')
			.get(values.project as string) as { id: number } | undefined;

		if (project_row) {
			for (const rel of relations) {
				try {
					const source_entity = dest_db
						.prepare('SELECT id FROM entities WHERE name = ? AND project_id = ?')
						.get(rel.source, project_row.id) as { id: number } | undefined;
					const target_entity = dest_db
						.prepare('SELECT id FROM entities WHERE name = ? AND project_id = ?')
						.get(rel.target, project_row.id) as { id: number } | undefined;

					if (!source_entity || !target_entity) continue;

					dest_db
						.prepare('INSERT OR IGNORE INTO relation_types (name) VALUES (?)')
						.run(rel.relation_type);
					const rel_type_row = dest_db
						.prepare('SELECT id FROM relation_types WHERE name = ?')
						.get(rel.relation_type) as { id: number };

					const rel_result = dest_db
						.prepare('INSERT OR IGNORE INTO relations (source_id, target_id, relation_type_id) VALUES (?, ?, ?)')
						.run(source_entity.id, target_entity.id, rel_type_row.id);
					if (rel_result.changes > 0) relation_count++;
				} catch (error) {
					console.error(`[${new Date().toISOString()}]   skipping relation ${rel.source} -> ${rel.target}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}
	});

	transaction();
	source_db.close();
	dest_db.close();

	console.log(`[${new Date().toISOString()}] Imported ${entity_count} entities, ${relation_count} relations into project "${values.project}" (${skipped} skipped)`);
}

main().catch(console.error);

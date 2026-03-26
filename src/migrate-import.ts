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
	const source_db = new Database(values.source as string, { readonly: true });
	const entities = source_db
		.prepare('SELECT name, entity_type FROM entities')
		.all() as Array<{ name: string; entity_type: string }>;

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
				.prepare('SELECT content FROM observations WHERE entity_name = ?')
				.all(entity.name) as Array<{ content: string }>;

			if (observations.length === 0) {
				skipped++;
				continue;
			}

			const existing = dest_db
				.prepare('SELECT rowid FROM entities WHERE name = ? AND project = ?')
				.get(entity.name, values.project as string) as { rowid: number } | undefined;

			let entity_rowid: number;
			if (existing) {
				entity_rowid = existing.rowid;
			} else {
				const result = dest_db
					.prepare('INSERT INTO entities (name, entity_type, project) VALUES (?, ?, ?)')
					.run(entity.name, entity.entity_type, values.project as string);
				entity_rowid = result.lastInsertRowid as number;
				entity_count++;
			}

			const existing_obs = new Set(
				(dest_db
					.prepare('SELECT content FROM observations WHERE entity_name = ?')
					.all(entity.name) as Array<{ content: string }>).map((r) => r.content),
			);

			const insert_obs = dest_db.prepare(
				'INSERT INTO observations (entity_name, content) VALUES (?, ?)',
			);
			for (const obs of observations) {
				if (!existing_obs.has(obs.content)) {
					insert_obs.run(entity.name, obs.content);
				}
			}

		}

		const relations = source_db
			.prepare('SELECT source, target, relation_type FROM relations')
			.all() as Array<{ source: string; target: string; relation_type: string }>;

		for (const rel of relations) {
			try {
				dest_db
					.prepare('INSERT OR IGNORE INTO relations (source, target, relation_type) VALUES (?, ?, ?)')
					.run(rel.source, rel.target, rel.relation_type);
				relation_count++;
			} catch (error) {
				console.error(`[${new Date().toISOString()}]   skipping relation ${rel.source} -> ${rel.target}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	});

	transaction();
	source_db.close();
	dest_db.close();

	console.log(`[${new Date().toISOString()}] Imported ${entity_count} entities, ${relation_count} relations into project "${values.project}" (${skipped} skipped)`);
}

main().catch(console.error);

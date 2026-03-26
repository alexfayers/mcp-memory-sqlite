import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { DatabaseManager } from '../client.js';
import { get_database_config } from '../config.js';
import { migrations } from './schema.js';

export function run_migrations(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);

	const entities_exist = db
		.prepare(
			`SELECT name FROM sqlite_master WHERE type='table' AND name='entities'`,
		)
		.get();

	const version_count = (
		db
			.prepare('SELECT COUNT(*) as count FROM schema_version')
			.get() as { count: number }
	).count;

	if (entities_exist && version_count === 0) {
		db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
		return;
	}

	const current_version =
		version_count > 0
			? (
					db
						.prepare(
							'SELECT MAX(version) as version FROM schema_version',
						)
						.get() as { version: number }
				).version
			: 0;

	db.pragma('foreign_keys = OFF');
	const apply = db.transaction(() => {
		for (const migration of migrations) {
			if (migration.version <= current_version) continue;
			for (const statement of migration.statements) {
				db.exec(statement);
			}
			db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
				migration.version,
			);
		}
	});
	apply();
	db.pragma('foreign_keys = ON');
}

async function run_migrations_cli() {
	const config = get_database_config();
	const db_manager = await DatabaseManager.get_instance(config);
	const db = db_manager.get_client();

	try {
		console.log(`[${new Date().toISOString()}] Starting migrations...`);
		run_migrations(db);
		console.log(`[${new Date().toISOString()}] Migrations completed successfully`);
	} catch (error) {
		console.error(`[${new Date().toISOString()}] Error running migrations:`, error);
		throw error;
	} finally {
		await db_manager.close();
	}
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
	run_migrations_cli()
		.then(() => process.exit(0))
		.catch((error) => {
			console.error(`[${new Date().toISOString()}]`, error);
			process.exit(1);
		});
}

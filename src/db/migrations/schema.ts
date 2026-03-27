interface Migration {
	version: number;
	statements: string[];
}

export const migrations: Migration[] = [
	{
		version: 1,
		statements: [
			`CREATE TABLE IF NOT EXISTS entities (
				name TEXT PRIMARY KEY,
				entity_type TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS observations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				entity_name TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (entity_name) REFERENCES entities(name)
			)`,
			`CREATE TABLE IF NOT EXISTS relations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				source TEXT NOT NULL,
				target TEXT NOT NULL,
				relation_type TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (source) REFERENCES entities(name),
				FOREIGN KEY (target) REFERENCES entities(name),
				UNIQUE(source, target, relation_type)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`,
			`CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_name)`,
			`CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source)`,
			`CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target)`,
		],
	},
	{
		version: 2,
		statements: [
			`CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(name, entity_type, observations, content='', tokenize='unicode61')`,
			`INSERT INTO entities_fts(rowid, name, entity_type, observations) SELECT e.rowid, e.name, e.entity_type, COALESCE((SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = e.name), '') FROM entities e`,
			`CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN INSERT INTO entities_fts(rowid, name, entity_type, observations) VALUES (new.rowid, new.name, new.entity_type, ''); END`,
			`CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations) VALUES('delete', old.rowid, old.name, old.entity_type, ''); END`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations) VALUES('delete', (SELECT rowid FROM entities WHERE name = new.entity_name), (SELECT name FROM entities WHERE name = new.entity_name), (SELECT entity_type FROM entities WHERE name = new.entity_name), ''); INSERT INTO entities_fts(rowid, name, entity_type, observations) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = new.entity_name) FROM entities WHERE name = new.entity_name; END`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_delete AFTER DELETE ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations) VALUES('delete', (SELECT rowid FROM entities WHERE name = old.entity_name), (SELECT name FROM entities WHERE name = old.entity_name), (SELECT entity_type FROM entities WHERE name = old.entity_name), ''); INSERT INTO entities_fts(rowid, name, entity_type, observations) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = old.entity_name) FROM entities WHERE name = old.entity_name; END`,
		],
	},
	{
		version: 3,
		statements: [
			`ALTER TABLE entities ADD COLUMN project TEXT NOT NULL DEFAULT ''`,
			`CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project)`,
			`DROP TRIGGER IF EXISTS entities_fts_insert`,
			`DROP TRIGGER IF EXISTS entities_fts_delete`,
			`DROP TRIGGER IF EXISTS observations_fts_insert`,
			`DROP TRIGGER IF EXISTS observations_fts_delete`,
			`INSERT INTO entities_fts(entities_fts) VALUES('delete-all')`,
			`DROP TABLE IF EXISTS entities_fts`,
			`CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(name, entity_type, observations, project, content='', tokenize='unicode61')`,
			`INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT e.rowid, e.name, e.entity_type, COALESCE((SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = e.name), ''), e.project FROM entities e`,
			`CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN INSERT INTO entities_fts(rowid, name, entity_type, observations, project) VALUES (new.rowid, new.name, new.entity_type, '', new.project); END`,
			`CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', old.rowid, old.name, old.entity_type, '', old.project); END`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', (SELECT rowid FROM entities WHERE name = new.entity_name), (SELECT name FROM entities WHERE name = new.entity_name), (SELECT entity_type FROM entities WHERE name = new.entity_name), '', (SELECT project FROM entities WHERE name = new.entity_name)); INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = new.entity_name), project FROM entities WHERE name = new.entity_name; END`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_delete AFTER DELETE ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', (SELECT rowid FROM entities WHERE name = old.entity_name), (SELECT name FROM entities WHERE name = old.entity_name), (SELECT entity_type FROM entities WHERE name = old.entity_name), '', (SELECT project FROM entities WHERE name = old.entity_name)); INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = old.entity_name), project FROM entities WHERE name = old.entity_name; END`,
		],
	},
	{
		version: 4,
		statements: [
			`DROP TRIGGER IF EXISTS entities_fts_insert`,
			`DROP TRIGGER IF EXISTS entities_fts_delete`,
			`DROP TRIGGER IF EXISTS observations_fts_insert`,
			`DROP TRIGGER IF EXISTS observations_fts_delete`,
			`INSERT INTO entities_fts(entities_fts) VALUES('delete-all')`,
			`DROP TABLE IF EXISTS entities_fts`,
			`ALTER TABLE entities RENAME TO entities_old`,
			`CREATE TABLE entities (
				name TEXT NOT NULL,
				entity_type TEXT NOT NULL,
				project TEXT NOT NULL DEFAULT '',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(name, project)
			)`,
			`INSERT INTO entities (name, entity_type, project, created_at) SELECT name, entity_type, project, created_at FROM entities_old`,
			`DROP TABLE entities_old`,
			`ALTER TABLE observations RENAME TO observations_old`,
			`CREATE TABLE observations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				entity_name TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (entity_name) REFERENCES entities(name)
			)`,
			`INSERT INTO observations SELECT * FROM observations_old`,
			`DROP TABLE observations_old`,
			`DROP INDEX IF EXISTS idx_entities_name`,
			`CREATE INDEX IF NOT EXISTS idx_entities_name_project ON entities(name, project)`,
			`CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(name, entity_type, observations, project, content='', tokenize='unicode61')`,
			`INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT e.rowid, e.name, e.entity_type, COALESCE((SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = e.name), ''), e.project FROM entities e`,
			`CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN INSERT INTO entities_fts(rowid, name, entity_type, observations, project) VALUES (new.rowid, new.name, new.entity_type, '', new.project); END`,
			`CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', old.rowid, old.name, old.entity_type, '', old.project); END`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', (SELECT rowid FROM entities WHERE name = new.entity_name), (SELECT name FROM entities WHERE name = new.entity_name), (SELECT entity_type FROM entities WHERE name = new.entity_name), '', (SELECT project FROM entities WHERE name = new.entity_name)); INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = new.entity_name), project FROM entities WHERE name = new.entity_name; END`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_delete AFTER DELETE ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', (SELECT rowid FROM entities WHERE name = old.entity_name), (SELECT name FROM entities WHERE name = old.entity_name), (SELECT entity_type FROM entities WHERE name = old.entity_name), '', (SELECT project FROM entities WHERE name = old.entity_name)); INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = old.entity_name), project FROM entities WHERE name = old.entity_name; END`,
		],
	},
	{
		version: 5,
		statements: [
			`ALTER TABLE relations RENAME TO relations_old`,
			`CREATE TABLE relations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				source TEXT NOT NULL,
				target TEXT NOT NULL,
				relation_type TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(source, target, relation_type)
			)`,
			`INSERT INTO relations (id, source, target, relation_type, created_at) SELECT id, source, target, relation_type, created_at FROM relations_old`,
			`DROP TABLE relations_old`,
		],
	},
	{
		version: 6,
		statements: [
			`DELETE FROM observations WHERE entity_name NOT IN (SELECT name FROM entities)`,
			`DELETE FROM relations WHERE source NOT IN (SELECT name FROM entities) OR target NOT IN (SELECT name FROM entities)`,
			`DROP TRIGGER IF EXISTS entities_fts_insert`,
			`DROP TRIGGER IF EXISTS entities_fts_delete`,
			`DROP TRIGGER IF EXISTS observations_fts_insert`,
			`DROP TRIGGER IF EXISTS observations_fts_delete`,
			`CREATE TRIGGER IF NOT EXISTS entities_fts_insert AFTER INSERT ON entities BEGIN INSERT INTO entities_fts(rowid, name, entity_type, observations, project) VALUES (new.rowid, new.name, new.entity_type, '', new.project); END`,
			`CREATE TRIGGER IF NOT EXISTS entities_fts_delete AFTER DELETE ON entities BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', old.rowid, old.name, old.entity_type, '', old.project); END`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', (SELECT rowid FROM entities WHERE name = new.entity_name), (SELECT name FROM entities WHERE name = new.entity_name), (SELECT entity_type FROM entities WHERE name = new.entity_name), '', (SELECT project FROM entities WHERE name = new.entity_name)); INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = new.entity_name), project FROM entities WHERE name = new.entity_name; END`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_delete AFTER DELETE ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', (SELECT rowid FROM entities WHERE name = old.entity_name), (SELECT name FROM entities WHERE name = old.entity_name), (SELECT entity_type FROM entities WHERE name = old.entity_name), '', (SELECT project FROM entities WHERE name = old.entity_name)); INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = old.entity_name), project FROM entities WHERE name = old.entity_name; END`,
		],
	},
	{
		version: 7,
		statements: [
			`ALTER TABLE observations RENAME TO observations_old`,
			`CREATE TABLE observations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				entity_name TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`INSERT INTO observations SELECT * FROM observations_old`,
			`DROP TABLE observations_old`,
			`DROP TRIGGER IF EXISTS observations_fts_insert`,
			`DROP TRIGGER IF EXISTS observations_fts_delete`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', (SELECT rowid FROM entities WHERE name = new.entity_name), (SELECT name FROM entities WHERE name = new.entity_name), (SELECT entity_type FROM entities WHERE name = new.entity_name), '', (SELECT project FROM entities WHERE name = new.entity_name)); INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = new.entity_name), project FROM entities WHERE name = new.entity_name; END`,
			`CREATE TRIGGER IF NOT EXISTS observations_fts_delete AFTER DELETE ON observations BEGIN INSERT INTO entities_fts(entities_fts, rowid, name, entity_type, observations, project) VALUES('delete', (SELECT rowid FROM entities WHERE name = old.entity_name), (SELECT name FROM entities WHERE name = old.entity_name), (SELECT entity_type FROM entities WHERE name = old.entity_name), '', (SELECT project FROM entities WHERE name = old.entity_name)); INSERT INTO entities_fts(rowid, name, entity_type, observations, project) SELECT rowid, name, entity_type, (SELECT GROUP_CONCAT(content, ' ') FROM observations WHERE entity_name = old.entity_name), project FROM entities WHERE name = old.entity_name; END`,
		],
	},
];

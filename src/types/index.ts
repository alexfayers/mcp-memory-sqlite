export type EntityStatus = 'planned' | 'in-progress' | 'blocked' | 'resolved' | 'archived';

export interface Entity {
	name: string;
	entityType: string;
	observations: string[];
	status?: EntityStatus | null;
}

export interface Relation {
	from: string;
	to: string;
	relationType: string;
}

export interface SearchResult {
	entity: Entity;
	distance: number;
}

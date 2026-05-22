import type { FilterAction, FilterCondition, FilterDto } from "@mailclient/shared";
import { db } from "./index.js";

interface FilterRow {
  id: number;
  name: string;
  enabled: number;
  match_type: string;
  conditions_json: string;
  actions_json: string;
}

function rowToDto(r: FilterRow): FilterDto {
  return {
    id: r.id,
    name: r.name,
    enabled: !!r.enabled,
    matchType: r.match_type as "all" | "any",
    conditions: JSON.parse(r.conditions_json) as FilterCondition[],
    actions: JSON.parse(r.actions_json) as FilterAction[],
  };
}

export const filtersRepo = {
  list(): FilterDto[] {
    const rows = db.prepare("SELECT * FROM filters ORDER BY id").all() as FilterRow[];
    return rows.map(rowToDto);
  },
  create(input: Omit<FilterDto, "id">): FilterDto {
    const result = db
      .prepare(
        `INSERT INTO filters (name, enabled, match_type, conditions_json, actions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        input.enabled ? 1 : 0,
        input.matchType,
        JSON.stringify(input.conditions),
        JSON.stringify(input.actions),
        Date.now(),
      );
    return this.list().find((f) => f.id === Number(result.lastInsertRowid))!;
  },
  update(id: number, input: Partial<Omit<FilterDto, "id">>) {
    const existing = db.prepare("SELECT * FROM filters WHERE id = ?").get(id) as FilterRow | undefined;
    if (!existing) return;
    db.prepare(
      `UPDATE filters SET name = ?, enabled = ?, match_type = ?, conditions_json = ?, actions_json = ? WHERE id = ?`,
    ).run(
      input.name ?? existing.name,
      (input.enabled ?? !!existing.enabled) ? 1 : 0,
      input.matchType ?? existing.match_type,
      JSON.stringify(input.conditions ?? JSON.parse(existing.conditions_json)),
      JSON.stringify(input.actions ?? JSON.parse(existing.actions_json)),
      id,
    );
  },
  delete(id: number) {
    db.prepare("DELETE FROM filters WHERE id = ?").run(id);
  },
};

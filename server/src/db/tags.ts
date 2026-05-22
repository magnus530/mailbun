import type { TagDto } from "@mailclient/shared";
import { db } from "./index.js";

export const tagsRepo = {
  list(): TagDto[] {
    return db.prepare("SELECT id, name, color FROM tags ORDER BY name").all() as TagDto[];
  },
  upsert(name: string, color: string): TagDto {
    db.prepare(
      "INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color",
    ).run(name, color);
    return db.prepare("SELECT id, name, color FROM tags WHERE name = ?").get(name) as TagDto;
  },
  delete(id: number) {
    db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  },
  attach(threadId: number, tagId: number) {
    db.prepare("INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) VALUES (?, ?)").run(threadId, tagId);
  },
  detach(threadId: number, tagId: number) {
    db.prepare("DELETE FROM thread_tags WHERE thread_id = ? AND tag_id = ?").run(threadId, tagId);
  },
};

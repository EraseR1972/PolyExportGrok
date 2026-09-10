import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRecents, recentId, upsertRecent, type RecentConversion } from "./recents.ts";

function item(name: string, n: number): RecentConversion {
  return {
    id: recentId(name),
    fileName: name,
    name: name.replace(/\.obj$/i, ""),
    poly: { positions: [n, 0, 0], faces: [] },
    scale: 1,
    axis: "y-up",
    pivot: "center",
    color: "#c4bfb4",
    at: n,
  };
}

describe("recents", () => {
  it("keeps the newest 5 and moves duplicates to the front", () => {
    let list: RecentConversion[] = [];
    for (const name of ["a.obj", "b.obj", "c.obj", "d.obj", "e.obj", "f.obj"]) {
      list = upsertRecent(list, item(name, list.length));
    }
    assert.equal(list.length, 5);
    assert.deepEqual(
      list.map((r) => r.fileName),
      ["f.obj", "e.obj", "d.obj", "c.obj", "b.obj"],
    );
    list = upsertRecent(list, item("c.obj", 99));
    assert.equal(list[0]?.fileName, "c.obj");
    assert.equal(list[0]?.poly.positions[0], 99);
    assert.equal(list.length, 5);
  });

  it("parses stored JSON", () => {
    const raw = JSON.stringify([item("hull.obj", 1)]);
    const list = parseRecents(raw);
    assert.equal(list[0]?.name, "hull");
    assert.equal(list[0]?.id, "recent:hull.obj");
  });
});

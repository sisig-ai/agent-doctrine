import { appendNote } from "../../scripts/handoff.ts";

const [note, tag] = process.argv.slice(2);
appendNote(
  note!,
  { blocks: [{ kind: "prose", text: `worker ${tag} prose` }] },
  {
    harness: "claude",
    model: "test-model",
    executor: (payload) => {
      (globalThis as { Bun?: { sleepSync?: (ms: number) => void } }).Bun?.sleepSync?.(200);
      return payload;
    },
  },
);

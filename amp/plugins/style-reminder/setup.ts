import { readFileSync } from "fs";

export function setupStyleReminder(path: string) {
  const text = readFileSync(path, "utf-8").trim();
  if (!text) throw new Error(`style-reminder: ${path} is empty`);
  return (amp: any) => {
    amp.on("agent.start", () => ({ message: { content: text, display: false } }));
  };
}

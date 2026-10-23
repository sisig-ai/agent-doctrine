import { fileURLToPath } from "url";
import { setupStyleReminder } from "./setup";

const reminderPath = fileURLToPath(new URL("../../style-reminder.md", import.meta.url));

export { setupStyleReminder };

export default setupStyleReminder(reminderPath);

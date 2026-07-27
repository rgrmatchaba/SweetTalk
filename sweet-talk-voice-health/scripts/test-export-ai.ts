import { generateText } from "ai";
import { getExportChatModel } from "../src/lib/ai-provider.server";

const start = Date.now();
const { text } = await generateText({
  model: getExportChatModel(),
  prompt: "Reply with exactly: OK",
});
console.log(`anthropic_ms=${Date.now() - start}`);
console.log(`response=${text.trim().slice(0, 50)}`);

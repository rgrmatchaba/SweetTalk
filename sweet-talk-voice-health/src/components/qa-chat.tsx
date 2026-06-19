import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Send, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { sweetTalkQAChat } from "@/lib/ai.functions";
import { toast } from "sonner";

interface Message {
  id: string;
  role: "user" | "bot";
  content: string;
}

const GREETING: Message = {
  id: "greeting",
  role: "bot",
  content:
    "Ask me anything about your glucose history — averages, trends, specific dates, highest or lowest readings, and more.",
};

export function QAChat() {
  const { user } = useAuth();
  const sendToQA = useServerFn(sweetTalkQAChat);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const threadId = user ? `qa-${user.id}` : undefined;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const addMessage = (role: "user" | "bot", content: string) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role, content }]);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    addMessage("user", text);
    setSending(true);
    try {
      const result = await sendToQA({ data: { message: text, threadId } });
      addMessage("bot", result.text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="p-4 flex flex-col h-[32rem]">
      <div className="flex-1 overflow-y-auto space-y-3 px-2 py-2">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2 text-sm bg-muted flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" /> thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 pt-2 border-t mt-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask about your glucose history..."
          disabled={sending}
        />
        <Button onClick={handleSend} disabled={sending || !input.trim()} size="icon">
          <Send className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { sweetTalkAgentChat } from "@/lib/ai.functions";
import { toast } from "sonner";

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export function ChatAgent() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const sendToAgent = useServerFn(sweetTalkAgentChat);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const todayDate = new Date().toLocaleDateString("en-CA");
  const threadId = user ? `chat-${user.id}` : undefined;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!user || !profile) return;
    let cancelled = false;

    (async () => {
      const { data: existing, error: findErr } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("user_id", user.id)
        .eq("session_date", todayDate)
        .maybeSingle();
      if (findErr) throw findErr;

      let sid = existing?.id as string | undefined;
      let isNew = false;

      if (!sid) {
        const { data: created, error: createErr } = await supabase
          .from("chat_sessions")
          .insert({ user_id: user.id, session_date: todayDate })
          .select("id")
          .single();
        if (createErr) throw createErr;
        sid = created.id;
        isNew = true;
      }

      const { data: msgs, error: msgErr } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", sid)
        .order("created_at", { ascending: true });
      if (msgErr) throw msgErr;

      if (cancelled) return;
      setSessionId(sid!);
      setMessages((msgs || []) as ChatMessage[]);
      setLoading(false);

      if (isNew) {
        const greeting = `Hi ${profile.name || "there"}! Tell me about a glucose reading, ask a question, or say what's on your mind — I'm listening.`;
        const { data: saved } = await supabase
          .from("chat_messages")
          .insert({ session_id: sid!, role: "bot", content: greeting })
          .select()
          .single();
        if (!cancelled && saved) setMessages((prev) => [...prev, saved as ChatMessage]);
      }
    })().catch((e) => {
      console.error(e);
      toast.error("Couldn't load chat");
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id, profile?.id, todayDate]);

  const persistMessage = async (sid: string, role: "bot" | "user", content: string) => {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ session_id: sid, role, content })
      .select()
      .single();
    if (error) throw error;
    setMessages((prev) => [...prev, data as ChatMessage]);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !sessionId || sending) return;
    setInput("");
    setSending(true);
    try {
      await persistMessage(sessionId, "user", text);
      const result = await sendToAgent({ data: { message: text, threadId } });
      await persistMessage(sessionId, "bot", result.text);
      qc.invalidateQueries({ queryKey: ["dashboard-logs"] });
      qc.invalidateQueries({ queryKey: ["history"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center h-96">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

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
          placeholder="Type a message..."
          disabled={sending}
        />
        <Button onClick={handleSend} disabled={sending || !input.trim()} size="icon">
          <Send className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

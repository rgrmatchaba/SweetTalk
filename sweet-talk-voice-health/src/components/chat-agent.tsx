import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Loader2, Trash2, Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { sweetTalkAgentChat, clearChatSession } from "@/lib/ai.functions";
import { toast } from "sonner";

const CONFIRM_MARKER = "[CONFIRM_CARD]";

function parseConfirmCard(content: string): { text: string; hasCard: boolean } {
  const idx = content.indexOf(CONFIRM_MARKER);
  if (idx === -1) return { text: content, hasCard: false };
  return { text: content.slice(0, idx).trim(), hasCard: true };
}

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
  const clearChat = useServerFn(clearChatSession);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Track which confirm-card message IDs have been acted on (Save or Cancel)
  const [actedCards, setActedCards] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const todayDate = new Date().toLocaleDateString("en-CA");
  const threadId = user ? `chat-${user.id}` : undefined;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const startFreshSession = async () => {
    if (!user || !profile) return;

    const { data: created, error: createErr } = await supabase
      .from("chat_sessions")
      .insert({ user_id: user.id, session_date: todayDate })
      .select("id")
      .single();
    if (createErr) throw createErr;

    const sid = created.id;
    const greeting = `Hi ${profile.name || "there"}! Tell me about a glucose reading, ask a question, or say what's on your mind — I'm listening.`;
    const { data: saved, error: greetErr } = await supabase
      .from("chat_messages")
      .insert({ session_id: sid, role: "bot", content: greeting })
      .select()
      .single();
    if (greetErr) throw greetErr;

    setSessionId(sid);
    setMessages([saved as ChatMessage]);
  };

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

  const handleClear = async () => {
    if (clearing || sending) return;
    setClearing(true);
    try {
      await clearChat();
      await startFreshSession();
      toast.success("Chat cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't clear chat");
    } finally {
      setClearing(false);
    }
  };

  const persistMessage = async (sid: string, role: "bot" | "user", content: string) => {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ session_id: sid, role, content })
      .select()
      .single();
    if (error) throw error;
    setMessages((prev) => [...prev, data as ChatMessage]);
  };

  const sendText = async (text: string) => {
    if (!sessionId || sending) return;
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendText(text);
  };

  const handleConfirm = async (msgId: string, action: "save" | "cancel") => {
    setActedCards((prev) => new Set(prev).add(msgId));
    await sendText(action === "save" ? "yes" : "cancel");
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
      <div className="flex items-center justify-between mb-2 px-2">
        <p className="text-sm font-medium">Chat</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={clearing || sending}
          className="text-muted-foreground"
        >
          {clearing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          Clear chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 px-2 py-2">
        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap bg-primary text-primary-foreground">
                  {m.content}
                </div>
              </div>
            );
          }

          const { text, hasCard } = parseConfirmCard(m.content);
          const acted = actedCards.has(m.id);

          return (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[80%] space-y-2">
                <div className="rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap bg-muted">
                  {text}
                </div>
                {hasCard && !acted && (
                  <div className="flex gap-2 pl-1">
                    <Button
                      size="sm"
                      onClick={() => handleConfirm(m.id, "save")}
                      disabled={sending}
                      className="gap-1.5"
                    >
                      <Check className="size-3.5" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleConfirm(m.id, "cancel")}
                      disabled={sending}
                      className="gap-1.5"
                    >
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                  </div>
                )}
                {hasCard && acted && (
                  <p className="pl-1 text-xs text-muted-foreground">Responded ✓</p>
                )}
              </div>
            </div>
          );
        })}
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

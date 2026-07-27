import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Send, Loader2, Trash2, Check, X, ClipboardCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { sweetTalkAgentChat, clearChatSession } from "@/lib/ai.functions";
import { toast } from "sonner";

const CONFIRM_MARKER = "[CONFIRM_CARD]";

interface ConfirmCardData {
  title: string;
  rows: [string, string][];
}

interface ParsedBotMessage {
  text: string;
  hasCard: boolean;
  card: ConfirmCardData | null;
}

/**
 * Confirm-card messages arrive as text between `---` fences followed by the
 * marker. Parse them into title + rows for a styled card; fall back to the
 * raw text if the shape is unexpected.
 */
function parseConfirmCard(content: string): ParsedBotMessage {
  const idx = content.indexOf(CONFIRM_MARKER);
  if (idx === -1) return { text: content, hasCard: false, card: null };

  const before = content.slice(0, idx).trim();
  const start = before.indexOf("---");
  const end = before.lastIndexOf("---");
  if (start === -1 || end <= start) return { text: before, hasCard: true, card: null };

  const lines = before
    .slice(start + 3, end)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let title = "Reading";
  const rows: [string, string][] = [];
  for (const line of lines) {
    const row = line.match(/^-\s*([^:]+):\s*(.*)$/);
    if (row) rows.push([row[1], row[2]]);
    else title = line;
  }

  return { text: before.slice(0, start).trim(), hasCard: true, card: { title, rows } };
}

/* Landing page palette: ink #0C231B · moss #143528 · honey #E8A33D · mist #A8C0B5 */
function ConfirmCard({
  card,
  acted,
  sending,
  onConfirm,
}: {
  card: ConfirmCardData;
  acted: boolean;
  sending: boolean;
  onConfirm: (action: "save" | "cancel") => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-sm overflow-hidden rounded-2xl border border-[#E8A33D]/30 bg-[#143528] shadow-[0_20px_40px_-20px_rgba(12,35,27,0.6)]"
    >
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#0C231B] px-4 py-3">
        <div className="flex size-7 items-center justify-center rounded-lg bg-[#E8A33D]/15">
          <ClipboardCheck className="size-4 text-[#E8A33D]" />
        </div>
        <p className="text-sm font-semibold capitalize text-[#E8A33D]">{card.title}</p>
      </div>

      <div className="px-4 py-1.5">
        {card.rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2 text-sm last:border-0"
          >
            <span className="shrink-0 text-[#A8C0B5]">{label}</span>
            <span
              className={
                label.toLowerCase() === "glucose"
                  ? "text-right font-bold text-[#E8A33D]"
                  : "text-right font-medium text-[#EDE7D8]"
              }
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {acted ? (
        <p className="flex items-center gap-1.5 px-4 pb-3.5 pt-1 text-xs font-medium text-[#8BD8A8]">
          <Check className="size-3.5" strokeWidth={3} /> Responded
        </p>
      ) : (
        <div className="flex gap-2 px-4 pb-4 pt-1.5">
          <button
            onClick={() => onConfirm("save")}
            disabled={sending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#E8A33D] px-4 py-2 text-sm font-bold text-[#0C231B] transition hover:bg-[#F2B658] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-3.5" strokeWidth={3} />
            Save
          </button>
          <button
            onClick={() => onConfirm("cancel")}
            disabled={sending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-[#A8C0B5] transition hover:border-white/30 hover:bg-white/5 hover:text-[#F6F3EC] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="size-3.5" />
            Cancel
          </button>
        </div>
      )}
    </motion.div>
  );
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

          const { text, hasCard, card } = parseConfirmCard(m.content);
          const acted = actedCards.has(m.id);

          return (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[80%] space-y-2">
                {text.length > 0 && (
                  <div className="rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap bg-muted">
                    {text}
                  </div>
                )}
                {hasCard && card && (
                  <ConfirmCard
                    card={card}
                    acted={acted}
                    sending={sending}
                    onConfirm={(action) => handleConfirm(m.id, action)}
                  />
                )}
                {hasCard && !card && !acted && (
                  <div className="flex gap-2 pl-1">
                    <Button size="sm" onClick={() => handleConfirm(m.id, "save")} disabled={sending} className="gap-1.5">
                      <Check className="size-3.5" />
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleConfirm(m.id, "cancel")} disabled={sending} className="gap-1.5">
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                  </div>
                )}
                {hasCard && !card && acted && (
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

import { useState, useRef, useCallback } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useServerFn } from "@tanstack/react-start";
import { sweetTalkAgentChat, transcribeAudio } from "@/lib/ai.functions";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "audio/webm";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // strip the "data:<mime>;base64," prefix
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function VoiceAgent() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const sendToAgent = useServerFn(sweetTalkAgentChat);
  const transcribe = useServerFn(transcribeAudio);

  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [manualText, setManualText] = useState("");
  const [processing, setProcessing] = useState<"transcribing" | "thinking" | null>(null);
  const [reply, setReply] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const threadId = user ? `chat-${user.id}` : undefined;

  const sendToAgentFn = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!profile) {
        toast.error("Profile not loaded yet — try again in a moment");
        return;
      }
      setProcessing("thinking");
      setReply(null);
      try {
        const result = await sendToAgent({ data: { message: trimmed, threadId } });
        setReply(result.text);
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(result.text));
        }
        qc.invalidateQueries({ queryKey: ["dashboard-logs"] });
        qc.invalidateQueries({ queryKey: ["history"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
        qc.invalidateQueries({ queryKey: ["profile"] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setProcessing(null);
      }
    },
    [profile, sendToAgent, threadId, qc],
  );

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice input isn't supported in this browser. Try typing instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      setTranscript("");
      setReply(null);

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size === 0) return;

        setProcessing("transcribing");
        try {
          const audioBase64 = await blobToBase64(blob);
          const { transcript: text } = await transcribe({ data: { audioBase64, mimeType } });
          setTranscript(text);
          if (text.trim()) {
            await sendToAgentFn(text);
          } else {
            toast.error("Didn't catch that — try again.");
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Transcription failed");
        } finally {
          setProcessing((p) => (p === "transcribing" ? null : p));
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't access the microphone");
    }
  }, [sendToAgentFn, transcribe]);

  const stop = useCallback(() => {
    setRecording(false);
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

  const handleManualSend = () => {
    const text = manualText.trim();
    if (!text) return;
    setManualText("");
    sendToAgentFn(text);
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-col items-center gap-3 py-4">
        <Button
          size="icon"
          className={`size-16 rounded-full ${recording ? "bg-destructive hover:bg-destructive/90" : ""}`}
          onClick={recording ? stop : start}
          disabled={!!processing}
        >
          {recording ? <Square className="size-6" /> : <Mic className="size-6" />}
        </Button>
        <p className="text-sm text-muted-foreground">
          {recording
            ? "Recording... tap to stop"
            : processing === "transcribing"
              ? "Transcribing..."
              : processing === "thinking"
                ? "Thinking..."
                : "Tap to talk"}
        </p>
      </div>

      {transcript && (
        <div className="rounded-xl border bg-muted/50 p-3 text-sm">
          <p className="text-xs text-muted-foreground mb-1">You said:</p>
          <p>{transcript}</p>
        </div>
      )}

      {processing && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="size-4 animate-spin" />
          {processing === "transcribing" ? "transcribing..." : "thinking..."}
        </div>
      )}

      {reply && (
        <div className="rounded-xl border bg-card p-3 text-sm whitespace-pre-wrap">{reply}</div>
      )}

      <div className="flex gap-2 pt-2 border-t">
        <Input
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleManualSend();
          }}
          placeholder="Or type instead..."
          disabled={!!processing}
        />
        <Button onClick={handleManualSend} disabled={!!processing || !manualText.trim()}>
          Send
        </Button>
      </div>
    </Card>
  );
}

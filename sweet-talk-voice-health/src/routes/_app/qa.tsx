import { createFileRoute } from "@tanstack/react-router";
import { QAChat } from "@/components/qa-chat";

export const Route = createFileRoute("/_app/qa")({ component: QAPage });

function QAPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Q&amp;A</h1>
        <p className="text-muted-foreground">
          Ask questions about your glucose readings, averages, and history.
        </p>
      </div>
      <QAChat />
    </div>
  );
}

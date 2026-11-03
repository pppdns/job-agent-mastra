import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Chat } from "@/components/chat";
import { threadIdSchema } from "@/lib/chat-schema";
import { getThreadMessages } from "@/server/threads";

export default function ChatPage({ params }: PageProps<"/c/[threadId]">) {
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <ChatLoader params={params} />
    </Suspense>
  );
}

async function ChatLoader({ params }: Pick<PageProps<"/c/[threadId]">, "params">) {
  const { threadId } = await params;
  if (!threadIdSchema.safeParse(threadId).success) notFound();
  // A chat that doesn't exist yet (fresh id) starts empty; the agent creates it on send.
  const messages = (await getThreadMessages(threadId)) ?? [];
  return <Chat key={threadId} threadId={threadId} initialMessages={messages} />;
}

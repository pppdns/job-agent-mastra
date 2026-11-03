"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Textarea } from "@/components/ui/textarea";

const transport = new DefaultChatTransport({ api: "/api/chat" });

export function Chat() {
  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) submit(event);
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 p-4" aria-label="Conversation">
              {messages.length === 0 && (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Paste a job listing or ask a question to get started.
                </p>
              )}
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatMessage message={message} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {error && (
        <p role="alert" className="px-4 pb-2 text-sm text-destructive">
          {error.message || "Something went wrong talking to the agent."}
        </p>
      )}

      <form onSubmit={submit} className="flex items-end gap-2 border-t p-4">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Paste a job listing or URL…"
          aria-label="Message"
          rows={2}
          className="max-h-48 min-h-12 resize-none"
        />
        {busy ? (
          <Button type="button" size="icon" variant="outline" onClick={stop} aria-label="Stop">
            <SquareIcon />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
            <ArrowUpIcon />
          </Button>
        )}
      </form>
    </div>
  );
}

function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  return (
    <Message align={isUser ? "end" : "start"} data-role={message.role}>
      <MessageContent>
        <Bubble variant={isUser ? "default" : "ghost"} align={isUser ? "end" : "start"}>
          <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

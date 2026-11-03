"use server";

import { refresh } from "next/cache";
import { threadIdSchema, threadTitleSchema } from "@/lib/chat-schema";
import { deleteThread, renameThread } from "@/server/threads";

export async function renameChat(threadId: string, title: string): Promise<void> {
  await renameThread(threadIdSchema.parse(threadId), threadTitleSchema.parse(title));
  refresh();
}

export async function deleteChat(threadId: string): Promise<void> {
  await deleteThread(threadIdSchema.parse(threadId));
  refresh();
}

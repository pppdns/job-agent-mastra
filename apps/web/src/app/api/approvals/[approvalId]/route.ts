import { getApprovalView } from "@copilot/db";
import { threadIdSchema } from "@/lib/chat-schema";
import { appDb } from "@/server/db";

// Current state of an approval, read from the database (never from the tool output in the chat).
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/approvals/[approvalId]">,
) {
  const { approvalId } = await params;
  const threadId = threadIdSchema.safeParse(new URL(request.url).searchParams.get("threadId"));
  const view = threadId.success ? await getApprovalView(await appDb(), approvalId) : undefined;
  // Approvals are only visible from the chat that proposed them.
  if (!view || view.threadId !== threadId.data) {
    return Response.json({ error: "Approval not found." }, { status: 404 });
  }
  return Response.json(view);
}

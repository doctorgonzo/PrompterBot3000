import { lockThread, postMessage, type Env } from "./discord.ts";
import { clearPromptClose, listDueCloses } from "./store.ts";

const CLOSING_NOTICE = "⏳ **Submissions are closed.** Thanks to everyone who entered.";

/**
 * Announces a deadline in the thread, then locks it.
 *
 * The notice goes first: posting to an archived thread is awkward, and if
 * locking fails for lack of the Manage Threads permission we still want people
 * to know the deadline passed.
 */
export async function closeThread(env: Env, threadId: string): Promise<boolean> {
  const posted = await postMessage(env, threadId, { content: CLOSING_NOTICE });

  if (!posted) {
    // Thread is gone (deleted, or its prompt was rerolled). Nothing to close.
    return false;
  }

  const locked = await lockThread(env, threadId);
  if (!locked) {
    console.warn("closed announcement posted but thread not locked", threadId);
  }
  return true;
}

/**
 * Runs hourly alongside the scheduled prompts. Deadlines are therefore accurate
 * to the hour rather than the minute; the prompt shows the exact time so nobody
 * has to guess.
 */
export async function runPromptClosures(env: Env, instant: Date): Promise<number> {
  const now = Math.floor(instant.getTime() / 1000);
  const due = await listDueCloses(env, now);

  let closed = 0;
  for (const pending of due) {
    try {
      if (await closeThread(env, pending.threadId)) closed++;
    } catch (error) {
      console.error("closing thread failed", pending.threadId, error);
    }
    // Clear either way: a thread we cannot close should not be retried forever.
    await clearPromptClose(env, pending.threadId);
  }

  return closed;
}

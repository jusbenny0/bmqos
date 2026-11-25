/* Reply queue from "Now": a job is only removed after a successful send, otherwise it stays and draining stops. */
export interface Job { id: string; value: string; label: string }

export async function flushQueue(
  q: Job[],
  answer: (j: Job) => Promise<boolean>,
  online: () => boolean,
  drop: (id: string) => void,
): Promise<void> {
  for (const job of q) {
    if (!online()) break;
    if (!(await answer(job))) break;
    drop(job.id);
  }
}

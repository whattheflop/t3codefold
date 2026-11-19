import { useGT, T } from "gt-react";
import { useState } from "react";
import {
  verificationProposalApprovalAction,
  type PitbossAction,
  type PitbossTask,
} from "@t3tools/contracts";
import { Button } from "../ui/button";

export function TaskDecisionCard({
  task,
  busy,
  command,
  draft,
  onDraftChange,
}: {
  task: PitbossTask;
  draft?: string;
  onDraftChange?: (value: string) => void;
  busy: boolean;
  command: (action: PitbossAction) => Promise<boolean>;
}) {
  const gt = useGT();
  const [localAnswer, setLocalAnswer] = useState("");
  const answer = draft ?? localAnswer;
  const setAnswer = onDraftChange ?? setLocalAnswer;
  const pending =
    task.status === "cancelled"
      ? undefined
      : task.decisions?.find((decision) => decision.answer === undefined);
  if (!pending) return null;
  const proposalApproval = verificationProposalApprovalAction(task);
  const approvesProposal = proposalApproval?.decisionId === pending.id;
  const submit = (value: string) => {
    if (value.trim())
      void command({
        type: "resolve-decision",
        taskId: task.id,
        decisionId: pending.id,
        answer: value.trim(),
      }).then((saved) => {
        if (saved) setAnswer("");
      });
  };
  return (
    <section
      aria-label={gt("Your decision")}
      className="my-4 space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4"
    >
      <h4 className="font-semibold">
        <T>Your decision</T>
      </h4>
      <p>{pending.question}</p>
      <p className="text-sm">
        <strong>
          <T>Recommendation: </T>
        </strong>
        {pending.recommendation || gt("No recommendation yet.")}
      </p>
      <p className="text-sm text-muted-foreground">
        <T>
          This decision pauses this task. Independent work can continue. You can leave this decision
          for later.
        </T>
      </p>
      <div className="flex flex-wrap gap-2">
        {proposalApproval && approvesProposal && (
          <Button
            size="sm"
            disabled={busy || !!task.homeEnvironmentId}
            onClick={() => void command(proposalApproval)}
          >
            <T>Approve and save evidence profile</T>
          </Button>
        )}
        {pending.options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant="outline"
            disabled={busy || !!task.homeEnvironmentId}
            onClick={() => submit(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      {proposalApproval && approvesProposal && (
        <p className="text-xs text-muted-foreground">
          <T>
            Only “Approve and save evidence profile” saves the exact proposed checks. Other choices
            and written replies answer the decision without changing proof requirements.
          </T>
        </p>
      )}
      <label className="block text-sm">
        <T>Your direction</T>
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-input bg-background p-2"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={gt("Or give your own direction")}
        />
      </label>
      <Button
        size="sm"
        disabled={busy || !answer.trim() || !!task.homeEnvironmentId}
        onClick={() => submit(answer)}
      >
        <T>Send decision</T>
      </Button>
    </section>
  );
}

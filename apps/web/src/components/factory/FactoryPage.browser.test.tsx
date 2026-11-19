import type { EnvironmentId, FactoryBoard, FactoryCard } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { CardDetail, Decisions } from "./FactoryPage";

const { answer } = vi.hoisted(() => ({ answer: vi.fn(async () => undefined) }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => answer }));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({ data: undefined }) }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { factoryAnswerCard: { permissionAtom: () => null } },
}));

const card = {
  id: "decision",
  revision: 1,
  state: "open",
  createdAt: 0,
  ownerId: "worker",
  body: {
    title: "Choose a rollout",
    urgency: "now",
    kind: "decision",
    blocking: true,
    context: { doing: "Prepare rollout", whyNotMe: "Owner choice", costOfWaiting: "Checks wait" },
    options: [
      {
        id: "A",
        label: "Run checks",
        recommended: true,
        nextStep: "Check",
        cost: "Low",
        reversibility: "reversible",
        consequences: "More evidence",
      },
      {
        id: "B",
        label: "Preview",
        recommended: false,
        nextStep: "Preview",
        cost: "Low",
        reversibility: "reversible",
        consequences: "Early feedback",
      },
    ],
    rationale: "Choose deliberately",
    caveats: [],
    links: [],
  },
} as unknown as FactoryCard;

it("Enter on a focused option stages that option without sending a previously staged answer", async () => {
  answer.mockClear();
  await using screen = await render(
    <CardDetail environmentId={"local" as EnvironmentId} card={card} owner={undefined} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /A · Run checks/ }));
  const optionB = screen.getByRole("button", { name: /B · Preview/ });
  (optionB.element() as HTMLButtonElement).focus();
  await userEvent.keyboard("{Enter}");
  expect(answer).not.toHaveBeenCalled();
  await expect.element(optionB).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
  expect(answer).toHaveBeenCalledWith({
    environmentId: "local",
    input: { cardId: "decision", revision: 1, optionId: "B" },
  });
});

it("returns to the narrow inbox and history when the last open decision disappears", async () => {
  await page.viewport(390, 844);
  const board = {
    cards: [card],
    agents: [],
    triggers: [],
    runs: [],
    wakes: [],
    spawns: [],
    jobs: [],
    executions: [],
  } as unknown as FactoryBoard;
  await using screen = await render(
    <Decisions environmentId={"local" as EnvironmentId} board={board} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /Choose a rollout/ }));
  await expect.element(screen.getByRole("button", { name: /All decisions/ })).toBeVisible();
  await screen.rerender(
    <Decisions
      environmentId={"local" as EnvironmentId}
      board={{ ...board, cards: [{ ...card, state: "answered", outcome: "CHOSE" }] }}
    />,
  );
  await expect.element(screen.getByRole("complementary", { name: "Open decisions" })).toBeVisible();
  await expect.element(screen.getByText("Recent answers", { exact: true })).toBeVisible();
});

import { useMemo } from "react";
import { FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import {
  buildGladosBoard,
  gladosBoardColumnWidth,
  managedWorkerRows,
} from "@t3tools/client-runtime/glados-board";
import {
  pitbossMessageHeadline,
  type PitbossSnapshot,
  type PitbossTask,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { AppText as Text } from "../../components/ui/AppText";

const dots = {
  attention: "bg-amber-500",
  working: "bg-sky-500",
  review: "bg-violet-500",
  done: "bg-emerald-500",
  muted: "bg-foreground-muted",
};

/** Observational board: GLaDOS handles task transitions, including verification, through chat. */
export function GladosBoard(props: {
  state: PitbossSnapshot;
  width: number;
  search: string;
  onSearch: (value: string) => void;
  projectFilter: ProjectId | undefined;
  onProjectFilter: (value: ProjectId | undefined) => void;
  projectName: (id: ProjectId) => string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onOpenWorker: (task: PitbossTask, threadId: ThreadId) => void;
  onTalkToGlados: () => void;
}) {
  const lanes = useMemo(
    () =>
      buildGladosBoard(props.state, {
        query: props.search,
        projectId: props.projectFilter,
      }),
    [props.state, props.search, props.projectFilter],
  );
  const task = props.state.tasks.find((value) => `task:${value.id}` === props.selectedKey);
  const talk = (
    <Pressable
      accessibilityRole="button"
      onPress={props.onTalkToGlados}
      className="min-h-12 justify-center rounded-xl bg-primary px-4 py-3"
    >
      <Text className="text-center font-semibold text-primary-foreground">Talk to GLaDOS</Text>
    </Pressable>
  );
  if (task)
    return (
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => props.onSelect(null)}
          className="min-h-12 justify-center"
        >
          <Text className="text-primary">Back to board</Text>
        </Pressable>
        <Text accessibilityRole="header" className="text-xl font-semibold">
          {task.title}
        </Text>
        <Text className="text-sm text-foreground-muted">
          {task.status} · {props.projectName(task.projectId)}
        </Text>
        <Text>{task.outcome}</Text>
        {!!task.note && <Text className="text-foreground-muted">{task.note}</Text>}
        {managedWorkerRows(task, props.state.awaitingApproval).length > 0 && (
          <View className="gap-2">
            <Text accessibilityRole="header" className="font-semibold">
              Managed workers
            </Text>
            {managedWorkerRows(task, props.state.awaitingApproval).map((worker) => (
              <Pressable
                key={worker.attemptId}
                accessibilityRole="button"
                accessibilityLabel={`Open worker ${worker.generation}, ${worker.state}`}
                onPress={() => props.onOpenWorker(task, worker.threadId)}
                className="min-h-12 justify-center rounded-xl border border-border px-3"
              >
                <Text>
                  Worker {worker.generation} · {worker.state}
                </Text>
                <Text numberOfLines={1} className="text-xs text-foreground-muted">
                  {worker.model} · {worker.current ? "current" : "history"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {props.state.messages
          .filter((message) => message.taskId === task.id && !message.acknowledged)
          .map((message) => (
            <Text key={message.id} className="rounded-xl border border-border p-3">
              {pitbossMessageHeadline(message)}
            </Text>
          ))}
        <Text className="text-sm text-foreground-muted">
          GLaDOS coordinates workers and verification. Give direction or answer questions in chat.
        </Text>
        {talk}
        <Text accessibilityRole="header" className="font-semibold">
          Evidence · {task.evidence.length}
        </Text>
        {task.evidence.map((evidence) => (
          <View key={evidence.id} className="gap-2 rounded-xl border border-border p-3">
            <Text className="font-medium">
              {evidence.verdict} · {evidence.provenance.replaceAll("_", " ")}
            </Text>
            <Text>{evidence.summary}</Text>
          </View>
        ))}
      </ScrollView>
    );
  return (
    <View className="flex-1">
      <View className="gap-2 border-b border-border px-4 py-3">
        <Text className="text-sm text-foreground-muted">
          GLaDOS manages the work. Follow progress here; give direction in chat.
        </Text>
        <TextInput
          accessibilityLabel="Search Glados board"
          placeholder="Find an outcome…"
          value={props.search}
          onChangeText={props.onSearch}
          className="min-h-12 rounded-xl border border-input-border px-3 text-foreground"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {[undefined, ...new Set(props.state.tasks.map((value) => value.projectId))].map((id) => (
            <Pressable
              key={id ?? "all"}
              accessibilityRole="button"
              accessibilityState={{ selected: props.projectFilter === id }}
              onPress={() => props.onProjectFilter(id)}
              className={`min-h-12 justify-center rounded-xl px-3 ${props.projectFilter === id ? "bg-secondary" : "bg-subtle"}`}
            >
              <Text>{id ? props.projectName(id) : "All projects"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <ScrollView
        horizontal
        className="flex-1"
        contentContainerStyle={{ padding: 12, gap: 12 }}
        directionalLockEnabled
      >
        {lanes.map((lane) => (
          <View
            key={lane.id}
            style={{ width: gladosBoardColumnWidth(props.width) }}
            className="rounded-2xl border border-border bg-subtle/20"
          >
            <View className="flex-row items-center gap-2 px-3 py-4">
              <View className={`h-2 w-2 rounded-full ${dots[lane.tone]}`} />
              <Text accessibilityRole="header" className="font-semibold">
                {lane.label} · {lane.items.length}
              </Text>
            </View>
            <FlatList
              data={lane.items}
              keyExtractor={(item) => item.key}
              className="flex-1"
              nestedScrollEnabled
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              windowSize={5}
              contentContainerStyle={{ padding: 8, gap: 8 }}
              ListEmptyComponent={
                <Text className="p-3 text-sm text-foreground-muted">No work here</Text>
              }
              renderItem={({ item }) =>
                item.task ? (
                  <View className="rounded-xl border border-border bg-card">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${item.task.title}, ${lane.label}`}
                      onPress={() => props.onSelect(item.key)}
                      className="gap-2 p-3"
                    >
                      <Text numberOfLines={2} className="font-semibold">
                        {item.task.title}
                      </Text>
                      <Text numberOfLines={1} className="text-xs text-foreground-muted">
                        {props.projectName(item.task.projectId)}
                        {item.task.workspaceStrategy.type === "worktree" ? " · Worktree" : ""}
                      </Text>
                      <Text numberOfLines={3} className="text-sm text-foreground-muted">
                        {item.task.note || item.task.outcome}
                      </Text>
                      <Text className="text-xs text-foreground-muted">
                        {item.task.evidence.length} evidence · {item.task.attempts.length} attempts
                      </Text>
                      <Text numberOfLines={1} className="text-xs text-foreground-muted">
                        {item.task.attempts.at(-1)?.model.model ?? "GLaDOS"}
                      </Text>
                    </Pressable>
                    {managedWorkerRows(item.task, props.state.awaitingApproval)
                      .slice(0, 1)
                      .map((worker) => (
                        <Pressable
                          key={worker.attemptId}
                          accessibilityRole="button"
                          accessibilityLabel={`Open worker ${worker.generation}, ${worker.state}`}
                          onPress={() => props.onOpenWorker(item.task, worker.threadId)}
                          className="mx-2 mb-2 min-h-12 justify-center rounded-lg bg-subtle px-3"
                        >
                          <Text className="text-sm">
                            Worker {worker.generation} · {worker.state}
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                ) : (
                  <View className="gap-3 rounded-xl border border-border bg-card p-3">
                    <Text className="font-semibold">{pitbossMessageHeadline(item.message)}</Text>
                    <Text className="text-sm text-foreground-muted">{item.message.text}</Text>
                    {talk}
                  </View>
                )
              }
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

import Std

set_option warningAsError true

namespace Controller

inductive Mode where
  | reading | inspecting | reply | editing | navigation
  deriving DecidableEq, Repr

structure Owner where
  scope : Nat
  surface : Nat
  deriving DecidableEq, Repr

structure Frame where
  owner : Owner
  mode : Mode := .reading
  replyAvailable : Bool := true
  pendingReply : Bool := false
  voiceActive : Bool := false
  deriving DecidableEq, Repr

structure State where
  front : Frame
  parents : List Frame := []
  suspended : Bool := false
  epoch : Nat := 0
  revision : Nat := 0
  deriving DecidableEq, Repr

inductive Kind where
  | focus | edit | blur | startVoice | finishVoice | cancelVoice | activate | scroll | close
  deriving DecidableEq, Repr

structure Effect where
  owner : Owner
  kind : Kind
  deriving DecidableEq, Repr

structure Result where
  state : State
  effects : List Effect := []
  deriving DecidableEq, Repr

inductive Button where
  | reply | conversation | activate | back | dictate | scroll
  deriving DecidableEq, Repr

inductive Event where
  | input (button : Button)
  | push (owner : Owner)
  | scene (epoch revision : Nat) (replyAvailable : Bool)
  | suspend | resume
  deriving DecidableEq, Repr

def emit (s : State) (f : Frame) (kinds : List Kind) : Result :=
  ⟨{ s with front := f }, kinds.map fun kind => ⟨s.front.owner, kind⟩⟩

def reply (s : State) : Result :=
  if s.front.replyAvailable then
    emit s { s.front with mode := .reply, pendingReply := false } [.focus]
  else
    ⟨{ s with front.pendingReply := true }, []⟩

def back (s : State) : Result :=
  if s.front.voiceActive then
    emit s { s.front with mode := .reply, pendingReply := !s.front.replyAvailable, voiceActive := false } [.cancelVoice]
  else match s.front.mode with
  | .editing => emit s { s.front with mode := .reply, pendingReply := false } [.blur]
  | .reply | .inspecting => emit s { s.front with mode := .reading, pendingReply := false } [.focus]
  | .reading | .navigation =>
    match s.parents with
    | [] => ⟨s, []⟩
    | parent :: rest =>
      ⟨{ s with front := parent, parents := rest, epoch := s.epoch + 1, revision := 0 },
       [⟨s.front.owner, .close⟩]⟩

def input (s : State) (button : Button) : Result :=
  match button with
  | .reply => reply s
  | .conversation => emit s { s.front with mode := .reading, pendingReply := false } [.focus]
  | .back => back s
  | .scroll => emit s s.front [.scroll]
  | .dictate =>
    if s.front.voiceActive then
      emit s { s.front with mode := .reply, pendingReply := !s.front.replyAvailable, voiceActive := false } [.finishVoice]
    else if s.parents.any (·.voiceActive) then ⟨s, []⟩
    else if s.front.replyAvailable then
      emit s { s.front with mode := .reply, pendingReply := false, voiceActive := true } [.startVoice]
    else ⟨s, []⟩
  | .activate =>
    match s.front.mode with
    | .reading => emit s { s.front with mode := .inspecting, pendingReply := false } [.focus]
    | .reply =>
      if s.front.replyAvailable then
        emit s { s.front with mode := .editing, pendingReply := false } [.edit]
      else ⟨s, []⟩
    | .inspecting | .navigation => emit s s.front [.activate]
    | .editing => ⟨s, []⟩

def acceptScene (s : State) (revision : Nat) (available : Bool) : Result :=
  let updated := { s with front.replyAvailable := available, revision := revision }
  if s.front.pendingReply && available && !s.suspended then
    reply updated
  else ⟨updated, []⟩

def step (s : State) (event : Event) : Result :=
  match event with
  | .input button => if s.suspended then ⟨s, []⟩ else input s button
  | .push owner =>
    ⟨{ s with front := ⟨owner, .navigation, false, false, false⟩,
              parents := s.front :: s.parents, epoch := s.epoch + 1, revision := 0 }, []⟩
  | .scene epoch revision available =>
    if epoch == s.epoch && s.revision ≤ revision then acceptScene s revision available
    else ⟨s, []⟩
  | .suspend => ⟨{ s with suspended := true }, []⟩
  | .resume => emit { s with suspended := false } s.front [.focus]

def HasActivation (r : Result) : Prop :=
  ∃ effect ∈ r.effects, effect.kind = .activate

theorem reply_in_one_press (s : State) (active : s.suspended = false)
    (available : s.front.replyAvailable = true) :
    (step s (.input .reply)).state.front.mode = .reply := by
  simp [step, input, reply, active, available, emit]

theorem missing_reply_retains_intent (s : State) (active : s.suspended = false)
    (missing : s.front.replyAvailable = false) :
    (step s (.input .reply)).state.front.pendingReply = true := by
  simp [step, input, reply, active, missing]

theorem available_reply_completes_intent (s : State)
    (pending : s.front.pendingReply = true) (active : s.suspended = false)
    (revision : Nat) (fresh : s.revision ≤ revision) :
    (step s (.scene s.epoch revision true)).state.front.mode = .reply := by
  simp [step, acceptScene, pending, active, fresh, reply, emit]

theorem reply_preserves_surface (s : State) :
    (reply s).state.front.owner = s.front.owner := by
  unfold reply
  split <;> rfl

theorem modal_back_restores_invoker (s : State) (owner : Owner)
    (active : s.suspended = false) :
    (step (step s (.push owner)).state (.input .back)).state.front = s.front := by
  simp [step, input, back, active]

theorem modal_back_restores_stack (s : State) (owner : Owner)
    (active : s.suspended = false) :
    (step (step s (.push owner)).state (.input .back)).state.parents = s.parents := by
  simp [step, input, back, active]

theorem stale_epoch_is_ignored (s : State) (epoch revision : Nat) (available : Bool)
    (stale : epoch ≠ s.epoch) :
    step s (.scene epoch revision available) = ⟨s, []⟩ := by
  simp [step, stale]

theorem stale_revision_is_ignored (s : State) (revision : Nat) (available : Bool)
    (stale : revision < s.revision) :
    step s (.scene s.epoch revision available) = ⟨s, []⟩ := by
  simp [step, show ¬ s.revision ≤ revision by omega]

theorem suspended_input_is_inert (s : State) (button : Button)
    (suspended : s.suspended = true) :
    step s (.input button) = ⟨s, []⟩ := by
  simp [step, suspended]

theorem resume_preserves_destination (s : State) :
    (step s .resume).state.front = s.front := rfl

theorem resume_never_activates (s : State) : ¬ HasActivation (step s .resume) := by
  simp [HasActivation, step, emit]

theorem acquisition_never_activates (s : State) (reading : s.front.mode = .reading) :
    ¬ HasActivation (step s (.input .activate)) := by
  cases suspended : s.suspended <;> simp [step, input, reading, suspended, emit, HasActivation]

theorem input_effects_stay_with_owner (s : State) (button : Button)
    (effect : Effect) (member : effect ∈ (input s button).effects) :
    effect.owner = s.front.owner := by
  cases button <;> cases voice : s.front.voiceActive <;>
    cases parentVoice : s.parents.any (·.voiceActive) <;> cases mode : s.front.mode <;>
    cases available : s.front.replyAvailable <;> cases parents : s.parents <;>
    simp_all [input, reply, back, emit]
  all_goals split at member <;> simp_all

def modeCost : Mode → Nat
  | .reading | .navigation => 0
  | .inspecting | .reply => 1
  | .editing => 2

def frameCost (f : Frame) := if f.voiceActive then 2 else modeCost f.mode

def stackCost : List Frame → Nat
  | [] => 0
  | f :: rest => frameCost f + 1 + stackCost rest

def escapeCost (s : State) := frameCost s.front + stackCost s.parents

theorem back_decreases_cost (s : State) (positive : 0 < escapeCost s) :
    escapeCost (back s).state < escapeCost s := by
  cases voice : s.front.voiceActive <;> cases mode : s.front.mode <;> cases parents : s.parents <;>
    simp_all [back, emit, escapeCost, stackCost, frameCost, modeCost] <;> omega

def unwind : Nat → State → State
  | 0, s => s
  | n + 1, s => unwind n (back s).state

theorem bounded_escape (s : State) :
    ∃ presses, presses ≤ escapeCost s ∧ escapeCost (unwind presses s) = 0 := by
  generalize h : escapeCost s = n
  induction n using Nat.strongRecOn generalizing s with
  | ind n ih =>
    by_cases zero : n = 0
    · exact ⟨0, by omega, by simpa [unwind] using h.trans zero⟩
    · have less : escapeCost (back s).state < n := by
        rw [← h]
        exact back_decreases_cost s (by omega)
      obtain ⟨presses, budget, done⟩ := ih (escapeCost (back s).state) less (back s).state rfl
      exact ⟨presses + 1, by omega, by simpa [unwind] using done⟩

theorem active_back_is_back (s : State) (active : s.suspended = false) :
    step s (.input .back) = back s := by
  simp [step, input, active]

theorem cancellation_keeps_destination (s : State) (recording : s.front.voiceActive = true) :
    (back s).state.front.owner = s.front.owner ∧
    (back s).state.front.mode = .reply := by
  simp [back, recording, emit]

theorem accepted_scene_preserves_owner (s : State) (epoch revision : Nat) (available : Bool) :
    (step s (.scene epoch revision available)).state.front.owner = s.front.owner := by
  simp only [step]
  split
  · simp only [acceptScene]
    split
    · exact reply_preserves_surface _
    · rfl
  · rfl


theorem reply_does_not_change_recording (s : State) :
    (reply s).state.front.voiceActive = s.front.voiceActive := by
  unfold reply
  split <;> rfl

theorem parent_recording_blocks_new_voice (s : State)
    (busy : s.parents.any (·.voiceActive) = true) :
    ∀ effect ∈ (input s .dictate).effects, effect.kind ≠ .startVoice := by
  cases voice : s.front.voiceActive <;> simp [input, voice, busy, emit]


theorem frame_cost_bounded (f : Frame) : frameCost f ≤ 2 := by
  cases voice : f.voiceActive <;> cases mode : f.mode <;> simp [frameCost, modeCost, voice, mode]

theorem stack_cost_bounded (frames : List Frame) : stackCost frames ≤ 3 * frames.length := by
  induction frames with
  | nil => simp [stackCost]
  | cons f rest ih =>
    have cost := frame_cost_bounded f
    simp only [stackCost, List.length_cons, Nat.mul_add, Nat.mul_one]
    omega

theorem escape_budget (s : State) : escapeCost s ≤ 2 + 3 * s.parents.length := by
  have front := frame_cost_bounded s.front
  have parents := stack_cost_bounded s.parents
  unfold escapeCost
  omega

theorem bounded_escape_by_depth (s : State) :
    ∃ presses, presses ≤ 2 + 3 * s.parents.length ∧ escapeCost (unwind presses s) = 0 := by
  obtain ⟨presses, budget, done⟩ := bounded_escape s
  exact ⟨presses, Nat.le_trans budget (escape_budget s), done⟩

#print axioms reply_in_one_press
#print axioms missing_reply_retains_intent
#print axioms available_reply_completes_intent
#print axioms reply_preserves_surface
#print axioms modal_back_restores_invoker
#print axioms modal_back_restores_stack
#print axioms stale_epoch_is_ignored
#print axioms stale_revision_is_ignored
#print axioms suspended_input_is_inert
#print axioms resume_preserves_destination
#print axioms resume_never_activates
#print axioms acquisition_never_activates
#print axioms input_effects_stay_with_owner
#print axioms back_decreases_cost
#print axioms bounded_escape
#print axioms active_back_is_back
#print axioms cancellation_keeps_destination
#print axioms accepted_scene_preserves_owner
#print axioms reply_does_not_change_recording
#print axioms parent_recording_blocks_new_voice
#print axioms frame_cost_bounded
#print axioms stack_cost_bounded
#print axioms escape_budget
#print axioms bounded_escape_by_depth

end Controller

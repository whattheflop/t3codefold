import Controller
import Lean

open Controller Lean

inductive TraceEvent where
  | input (button : Button)
  | available (value : Bool)
  | push (scope surface : Nat)
  | suspend | resume

private def buttonName : Button → String
  | .reply => "reply"
  | .conversation => "conversation"
  | .activate => "activate"
  | .back => "back"
  | .dictate => "dictate"
  | .scroll => "scroll"

private def modeName : Mode → String
  | .reading => "reading"
  | .inspecting => "inspecting"
  | .reply => "reply"
  | .editing => "editing"
  | .navigation => "navigation"

private def observation (s : State) (activations : Nat) : Json :=
  Json.mkObj [
    ("mode", toJson (if s.suspended then "suspended" else if s.front.voiceActive then "recording" else modeName s.front.mode)),
    ("scope", toJson s.front.owner.scope),
    ("surface", toJson s.front.owner.surface),
    ("replySelected", toJson (s.front.replyAvailable &&
      (s.front.mode == .reply || s.front.mode == .editing))),
    ("activations", toJson activations)]

private def apply (s : State) : TraceEvent → Event
  | .input b => .input b
  | .available value => .scene s.epoch (s.revision + 1) value
  | .push scope surface => .push ⟨scope, surface⟩
  | .suspend => .suspend
  | .resume => .resume

private def eventJson : TraceEvent → Json
  | .input b => Json.mkObj [("action", toJson (buttonName b))]
  | .available b => Json.mkObj [("action", toJson "scene"), ("available", toJson b)]
  | .push scope surface => Json.mkObj [
      ("action", toJson "push"), ("scope", toJson scope), ("surface", toJson surface)]
  | .suspend => Json.mkObj [("action", toJson "suspended")]
  | .resume => Json.mkObj [("action", toJson "resumed")]

private def trace (s : State) (activations : Nat) : List TraceEvent → List Json
  | [] => []
  | event :: rest =>
    let result := step s (apply s event)
    let count := activations + (result.effects.filter fun e => e.kind == .activate).length
    Json.mkObj [("event", eventJson event), ("expected", observation result.state count)] ::
      trace result.state count rest

private def cases : List (String × List TraceEvent) := [
  ("reply-edit-back", [.input .reply, .input .activate, .input .back, .input .conversation]),
  ("acquire-is-not-activate", [.input .activate, .input .activate, .input .back]),
  ("delayed-reply", [.available false, .input .reply, .available true, .input .activate, .input .back]),
  ("cancel-reply-reappears", [.input .reply, .input .dictate, .input .back, .available false, .available true]),
  ("cancel-reply-was-missing", [.input .dictate, .available false, .input .back, .available true]),
  ("interruption-keeps-editor", [.input .reply, .input .activate, .suspend, .input .activate, .resume, .input .back]),
  ("nested-overlay-return", [.input .reply, .push 1 99, .push 2 100, .input .back, .input .back]),
  ("overlay-cannot-cancel-parent", [.input .dictate, .push 1 99, .input .back, .input .back])]

def main : IO Unit := do
  let vectors := [7, 42].flatMap fun surface => cases.map fun (name, events) =>
    let initial : State := { front := { owner := ⟨0, surface⟩ } }
    Json.mkObj [("name", toJson s!"{name}/surface-{surface}"),
      ("surface", toJson surface), ("initial", observation initial 0),
      ("steps", toJson (trace initial 0 events))]
  IO.println (Json.arr vectors.toArray).pretty

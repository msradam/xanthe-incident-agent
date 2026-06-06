import { assign, setup } from "xstate";

/**
 * A production incident-response runbook as a plain XState machine. The order is
 * enforced structurally: you cannot mitigate before diagnosing, resolve before
 * recovery is verified, or close before a postmortem is written. Two loops handle
 * reality (no cause found, mitigation failed). Each gated step records a field, so
 * by `closed` the context is a complete postmortem assembled as a side effect of
 * being forced through the right order.
 *
 *   detected -> triaged -> engaged -> investigating -> diagnosed
 *            -> mitigated -> recovered -> resolved -> closed
 */

interface RunbookContext {
  severity: string | null;
  hypothesis: string | null;
  rootCause: string | null;
  mitigation: string | null;
  verifiedBy: string | null;
  resolution: string | null;
  postmortem: string | null;
}

type RunbookEvent =
  | { type: "triage"; severity: string }
  | { type: "page_oncall" }
  | { type: "form_hypothesis"; hypothesis: string }
  | { type: "identify_root_cause"; rootCause: string }
  | { type: "no_cause_found" }
  | { type: "apply_mitigation"; mitigation: string }
  | { type: "verify_recovery"; signal: string }
  | { type: "mitigation_failed" }
  | { type: "resolve"; resolution: string }
  | { type: "write_postmortem"; summary: string };

export const incidentRunbook = setup({
  types: {} as { context: RunbookContext; events: RunbookEvent },
}).createMachine({
  id: "incidentRunbook",
  initial: "detected",
  context: {
    severity: null,
    hypothesis: null,
    rootCause: null,
    mitigation: null,
    verifiedBy: null,
    resolution: null,
    postmortem: null,
  },
  states: {
    detected: {
      on: { triage: { target: "triaged", actions: assign({ severity: ({ event }) => event.severity }) } },
    },
    triaged: {
      on: { page_oncall: "engaged" },
    },
    engaged: {
      on: {
        form_hypothesis: { target: "investigating", actions: assign({ hypothesis: ({ event }) => event.hypothesis }) },
      },
    },
    investigating: {
      on: {
        identify_root_cause: { target: "diagnosed", actions: assign({ rootCause: ({ event }) => event.rootCause }) },
        no_cause_found: "engaged",
      },
    },
    diagnosed: {
      on: {
        apply_mitigation: { target: "mitigated", actions: assign({ mitigation: ({ event }) => event.mitigation }) },
      },
    },
    mitigated: {
      on: {
        verify_recovery: { target: "recovered", actions: assign({ verifiedBy: ({ event }) => event.signal }) },
        mitigation_failed: "diagnosed",
      },
    },
    recovered: {
      on: { resolve: { target: "resolved", actions: assign({ resolution: ({ event }) => event.resolution }) } },
    },
    resolved: {
      on: { write_postmortem: { target: "closed", actions: assign({ postmortem: ({ event }) => event.summary }) } },
    },
    closed: { type: "final" },
  },
});

export default incidentRunbook;

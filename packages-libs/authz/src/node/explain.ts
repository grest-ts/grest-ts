import type {GGAuthzDecision, GGAuthzReason, GGAuthzRequest} from "../shared/authzSchemas"

/** e.g. "user:ben may vm:StopWorkspace on rn:… because group:eng has role operator on rn:…; boundary agents allows vm:*." */
export function explain(request: GGAuthzRequest, decision: GGAuthzDecision): string {
    const subject = `${request.subject.type}:${request.subject.id}`
    const human = request.subject.properties?.onBehalfOf
    const who = human ? `${subject} (on behalf of ${human.type}:${human.id})` : subject
    const what = `${request.action.name} on ${request.resource.id}`
    const reasons = decision.context.reasons.map(describe)
    if (decision.decision) {
        const approval = decision.context.outcome === "allow-with-approval" ? ` once approved (${decision.context.approval})` : ""
        return `${who} may ${what}${approval} because ${reasons.join("; ")}.`
    }
    const remedy = decision.context.remedy
    const fix = remedy?.scopes ? ` A token with scope ${remedy.scopes.join(" or ")} would be allowed.`
        : remedy?.stepUp ? ` Allowed after step-up authentication (${remedy.stepUp.join(", ")}).` : ""
    return `${who} may not ${what}: ${reasons.join("; ")}.${fix}`
}

function describe(r: GGAuthzReason): string {
    const at = r.on ? ` on ${r.on}` : ""
    const actions = r.actions ? ` ${r.actions.join(", ")}` : ""
    const layer = r.layer === "scope" ? "token scope" : r.layer === "restriction" ? "request restriction" : r.layer
    switch (r.kind) {
        case "invalid":
            return `invalid request (${r.message})`
        case "denied":
            return r.layer === "guardrail" ? `guardrail ${r.id}${at} denies${actions}` : `statement ${r.id}${at} denies${actions}`
        case "ceiling-failed":
            return `${layer} ${r.id}${at} does not allow it`
        case "ceiling-passed":
            return `${layer} ${r.id}${at} allows${actions}`
        case "binding":
            return r.layer === "grant" ? r.message! : `${r.principal} has role ${r.role}${at}`
        case "statement":
            return `resource policy${at} allows ${r.principal}${actions}`
        case "approval": {
            const source = r.on ? `set${at}${r.locked ? ", locked" : ""}` : r.message
            const lowered = r.lowered ? `; ${r.lowered.on} tried to lower it to ${r.lowered.level}` : ""
            return r.level === "humans-only" ? `approval level humans-only (${source}) shuts out workload principals${lowered}` : `approval level ${r.level} (${source})${lowered}`
        }
        case "no-grant":
            return r.message ?? "nothing grants it"
        case "escalation":
            return r.message!
    }
}

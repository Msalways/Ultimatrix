import type { AppModelFinding } from '../core/app-model';

export interface TriageDecision {
  candidateId: string;
  status: 'accepted' | 'downgraded' | 'duplicate' | 'rejected';
  reason: string;
  adjustedSeverity?: string;
  adjustedConfidence?: string;
  mergeWith?: string;
}

const TRIAGE_PROMPT = `You are an independent finding triage agent. Your job is to review one vulnerability candidate and decide whether it should become a final finding.

For each candidate, check:
1. **Evidence quality** — Does the evidence actually prove the vulnerability? Or is it circumstantial/hearsay?
2. **False positive risk** — Could this be a normal application behavior misidentified as a vulnerability?
3. **Severity calibration** — Is the severity rating appropriate for the actual impact?
4. **Confidence** — How sure are we? Consider: was the payload reflected? Was there a timing difference? Was there a confirmed error?
5. **Duplication** — Does this overlap with another finding?

Respond with a JSON object:
{
  "status": "accepted" | "downgraded" | "duplicate" | "rejected",
  "reason": "detailed justification for the decision",
  "adjustedSeverity": "critical" | "high" | "medium" | "low" | "info" (only if status is downgraded),
  "adjustedConfidence": "high" | "medium" | "low" (only if adjusting),
  "mergeWith": "finding-id" (only if duplicate)
}

Be conservative. Only accept findings with clear, direct evidence. Reject speculative or weak findings.`;

export function triageFinding(finding: AppModelFinding, existing: AppModelFinding[]): TriageDecision {
  const candidateId = `${finding.type}:${finding.endpoint}:${finding.param}`;

  // 1. Auto-reject if no evidence
  if (!finding.evidence || finding.evidence.length === 0) {
    return {
      candidateId,
      status: 'rejected',
      reason: 'No evidence provided — cannot verify without supporting data.',
    };
  }

  // 2. Check for exact duplicates by (type, endpoint, param)
  const duplicate = existing.find(
    f => f.type === finding.type && f.endpoint === finding.endpoint && f.param === finding.param
  );
  if (duplicate) {
    return {
      candidateId,
      status: 'duplicate',
      reason: `Duplicate of existing finding: ${duplicate.type} on ${duplicate.endpoint} (param: ${duplicate.param})`,
      mergeWith: `${duplicate.type}:${duplicate.endpoint}:${duplicate.param}`,
    };
  }

  // 3. Check evidence strength
  const hasScreenshot = finding.evidence.some(e => e.type === 'screenshot');
  const hasHar = finding.evidence.some(e => e.type === 'har_entry');
  const hasResponse = finding.evidence.some(e => e.type === 'raw_response' || e.type === 'raw_request');
  const hasReflected = finding.evidence.some(e =>
    e.label.toLowerCase().includes('reflected') || e.data.toLowerCase().includes('reflected')
  );
  const hasError = finding.evidence.some(e =>
    e.label.toLowerCase().includes('error') || e.data.toLowerCase().includes('error')
  );

  const evidenceScore = (hasScreenshot ? 1 : 0) + (hasHar ? 1 : 0) + (hasResponse ? 2 : 0) + (hasReflected ? 2 : 0) + (hasError ? 1 : 0);

  if (evidenceScore <= 1) {
    return {
      candidateId,
      status: 'rejected',
      reason: `Weak evidence (score ${evidenceScore}/7). Need at least response data or reflection evidence to confirm. Evidence types: ${finding.evidence.map(e => e.type).join(', ')}`,
    };
  }

  // 4. Calibrate severity based on evidence
  let severity = finding.severity || 'info';
  let confidence = finding.confidence || 'low';

  if (hasReflected && hasResponse) {
    confidence = 'high';
    if (severity === 'info') severity = 'low';
  } else if (hasError && hasResponse) {
    confidence = 'medium';
  }

  // 5. Downgrade speculative high/critical findings with only text evidence
  if ((severity === 'critical' || severity === 'high') && !hasHar && !hasScreenshot) {
    const adjusted = severity === 'critical' ? 'high' : 'medium';
    return {
      candidateId,
      status: 'downgraded',
      reason: `Downgraded from ${severity} to ${adjusted}: high-severity claim without HAR trace or screenshot evidence.`,
      adjustedSeverity: adjusted,
      adjustedConfidence: String(confidence),
    };
  }

  // 6. Accept with calibrated values
  if (severity !== finding.severity || confidence !== finding.confidence) {
    return {
      candidateId,
      status: 'downgraded',
      reason: `Adjusted severity from ${finding.severity} to ${severity} and confidence from ${finding.confidence} to ${confidence} based on evidence quality.`,
      adjustedSeverity: severity,
      adjustedConfidence: String(confidence),
    };
  }

  return {
    candidateId,
    status: 'accepted',
    reason: `Evidence confirms the finding. Evidence types: ${finding.evidence.map(e => `${e.type} (${e.label})`).join(', ')}`,
    adjustedConfidence: String(confidence),
  };
}

export function applyTriageToFindings(findings: AppModelFinding[], decisions: TriageDecision[]): AppModelFinding[] {
  const accepted: AppModelFinding[] = [];
  const seen = new Set<string>();

  for (const decision of decisions) {
    if (decision.status === 'rejected') continue;
    if (decision.status === 'duplicate') continue;

    const finding = findings.find(
      f => `${f.type}:${f.endpoint}:${f.param}` === decision.candidateId
    );
    if (!finding) continue;

    if (decision.adjustedSeverity) finding.severity = decision.adjustedSeverity;
    if (decision.adjustedConfidence) finding.confidence = decision.adjustedConfidence;

    const key = `${finding.type}:${finding.endpoint}:${finding.param}`;
    if (!seen.has(key)) {
      seen.add(key);
      accepted.push(finding);
    }
  }

  return accepted;
}

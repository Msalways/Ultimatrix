import type { AppModel, AppModelFinding, AppModelEndpoint, AppModelForm } from './app-model';

export type Technique =
  | 'sqli'
  | 'xss'
  | 'ssrf'
  | 'xxe'
  | 'cmd'
  | 'path'
  | 'ssti'
  | 'open-redirect'
  | 'idor'
  | 'race';

const STATIC_EXT = /\.(css|js|woff2?|png|svg|ico|map|jpg|jpeg|gif|webp|ttf|eot|pdf)$/i;

export type HypothesisStatus = 'pending' | 'running' | 'done' | 'error';
export type HypothesisSource = 'spider' | 'human' | 'worker-feedback' | 'strategist';

export interface ParamHypothesis {
  type: 'param';
  id: string;
  endpoint: string;
  param: string;
  method: string;
  technique: Technique;
  priority: number;
  status: HypothesisStatus;
  source: HypothesisSource;
  parentHypothesisId?: string;
  createdAt: number;
}

export interface FormHypothesis {
  type: 'form';
  id: string;
  action: string;
  method: 'POST';
  fields: string[];
  technique: Technique;
  priority: number;
  status: HypothesisStatus;
  source: HypothesisSource;
  parentHypothesisId?: string;
  createdAt: number;
}

export type Hypothesis = ParamHypothesis | FormHypothesis;

export interface AttackPlan {
  hypotheses: Hypothesis[];
  config: {
    maxConcurrency: number;
  };
}

export function createAttackPlan(config?: Partial<AttackPlan['config']>): AttackPlan {
  return {
    hypotheses: [],
    config: {
      maxConcurrency: config?.maxConcurrency ?? 4,
    },
  };
}

export function deriveHypotheses(
  appModel: AppModel,
  existingPlan: AttackPlan,
  source: HypothesisSource = 'spider',
): Hypothesis[] {
  const newHypotheses: Hypothesis[] = [];
  const existingKeys = new Set(
    existingPlan.hypotheses.map((h) =>
      h.type === 'param'
        ? `${h.method}:${h.endpoint}:${h.param}:${h.technique}`
        : `form:${h.action}:${h.fields.join(',')}:${h.technique}`,
    ),
  );
  const targetOrigin = getOrigin(appModel.target);

  for (const ep of appModel.endpoints) {
    const url = joinUrl(targetOrigin, ep.path);
    if (isStaticAsset(url) || isThirdParty(url, targetOrigin)) continue;
    const method = ep.method || 'GET';
    const params = ep.params || [];

    if (params.length === 0) {
      for (const technique of getDefaultTechniques(appModel)) {
        const key = `${method}:${url}::${technique}`;
        if (!existingKeys.has(key)) {
          newHypotheses.push(createParamHypothesis(url, '', method, technique, source, 5));
        }
      }
    } else {
      for (const param of params) {
        const paramName = param.name;
        if (!paramName || paramName === 'undefined') continue;
        for (const technique of getTechniquesForParam(paramName, appModel)) {
          const key = `${method}:${url}:${paramName}:${technique}`;
          if (!existingKeys.has(key)) {
            newHypotheses.push(createParamHypothesis(url, paramName, method, technique, source, 5));
          }
        }
      }
    }
  }

  for (const form of appModel.forms) {
    const action = form.action;
    if (isStaticAsset(action) || isThirdParty(action, targetOrigin)) continue;
    const fieldNames = form.fields.map(f => f.name).filter(Boolean);
    if (fieldNames.length === 0) continue;
    for (const technique of getDefaultTechniques(appModel)) {
      const key = `form:${action}:${fieldNames.join(',')}:${technique}`;
      if (!existingKeys.has(key)) {
        newHypotheses.push(createFormHypothesis(action, fieldNames, technique, source, 5));
      }
    }
  }

  return newHypotheses;
}

function isStaticAsset(url: string): boolean {
  try {
    const pathname = new URL(url, 'http://localhost').pathname;
    return STATIC_EXT.test(pathname);
  } catch {
    return STATIC_EXT.test(url);
  }
}

function isThirdParty(url: string, targetOrigin: string | null): boolean {
  if (!targetOrigin) return false;
  if (url.startsWith('/') || !url.startsWith('http')) return false;
  try {
    return new URL(url).origin !== targetOrigin;
  } catch {
    return false;
  }
}

function getOrigin(target: string): string | null {
  try {
    return new URL(target).origin;
  } catch {
    return null;
  }
}

function joinUrl(origin: string | null, pathOrUrl: string): string {
  if (!origin) return pathOrUrl;
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
  if (pathOrUrl.startsWith('/')) return origin + pathOrUrl;
  return origin + '/' + pathOrUrl;
}

export function prioritize(
  plan: AttackPlan,
  findings: AppModelFinding[],
): Hypothesis[] {
  const pending = plan.hypotheses.filter((h) => h.status === 'pending');
  if (pending.length === 0) return [];

  const endpointVulnCount = new Map<string, number>();
  for (const f of findings || []) {
    const ep = f.endpoint;
    endpointVulnCount.set(ep, (endpointVulnCount.get(ep) || 0) + 1);
  }

  const scored = pending.map((h) => {
    let score = h.priority;
    const ep = h.type === 'param' ? h.endpoint : h.action;
    const vulnCount = endpointVulnCount.get(ep) || 0;

    if (vulnCount > 0) {
      score += vulnCount * 3;
    }

    if (h.source === 'worker-feedback') {
      score += 2;
    }

    if (h.source === 'strategist') {
      score += 1;
    }

    return { hypothesis: h, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.hypothesis);
}

export function findFollowUpHypotheses(
  finding: AppModelFinding,
  plan: AttackPlan,
): Hypothesis[] {
  const followUps: Hypothesis[] = [];
  const existingKeys = new Set(
    plan.hypotheses.map((h) =>
      h.type === 'param'
        ? `param:${h.endpoint}:${h.param}:${h.technique}`
        : `form:${h.action}:${h.fields.join(',')}:${h.technique}`,
    ),
  );

  const ep = finding.endpoint;
  const param = finding.param;

  const deeperTechniques: Technique[] = getDeeperTechniques(finding.type as Technique);
  for (const technique of deeperTechniques) {
    const key = `followup:${ep}:${param || ''}:${technique}`;
    if (!existingKeys.has(key)) {
      followUps.push(createParamHypothesis(ep, param || '', 'GET', technique, 'worker-feedback', 8));
    }
  }

  return followUps;
}

function createParamHypothesis(
  endpoint: string,
  param: string,
  method: string,
  technique: Technique,
  source: HypothesisSource,
  priority: number,
): ParamHypothesis {
  return {
    type: 'param',
    id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    endpoint,
    param,
    method,
    technique,
    priority,
    status: 'pending',
    source,
    createdAt: Date.now(),
  };
}

function createFormHypothesis(
  action: string,
  fields: string[],
  technique: Technique,
  source: HypothesisSource,
  priority: number,
): FormHypothesis {
  return {
    type: 'form',
    id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    method: 'POST',
    fields,
    technique,
    priority,
    status: 'pending',
    source,
    createdAt: Date.now(),
  };
}

function getDefaultTechniques(appModel: AppModel): Technique[] {
  const techStack = appModel.techStack.map((t) => t.toLowerCase());
  const techniques: Technique[] = ['xss', 'sqli', 'ssrf', 'open-redirect'];

  if (techStack.some((t) => t.includes('xml') || t.includes('soap'))) {
    techniques.push('xxe');
  }
  if (techStack.some((t) => t.includes('jinja') || t.includes('twig') || t.includes('freemarker'))) {
    techniques.push('ssti');
  }
  if (techStack.some((t) => t.includes('command') || t.includes('exec'))) {
    techniques.push('cmd');
  }

  return techniques;
}

export type HypothesisDerivationMode = 'keyword' | 'llm';

export interface DeriveHypothesesWithLLMOptions {
  appModel: AppModel;
  existingPlan: AttackPlan;
  llmSelector: {
    selectForEndpoint: (endpoint: AppModelEndpoint, appModel: AppModel) => Promise<{ techniques: Technique[]; reasoning: string; source: 'llm' | 'fallback'; error?: string }>;
    selectForForm: (form: AppModelForm, appModel: AppModel) => Promise<{ techniques: Technique[]; reasoning: string; source: 'llm' | 'fallback'; error?: string }>;
  };
  source?: HypothesisSource;
}

export async function deriveHypothesesWithLLM(opts: DeriveHypothesesWithLLMOptions): Promise<Hypothesis[]> {
  const { appModel, existingPlan, llmSelector, source = 'strategist' } = opts;
  const newHypotheses: Hypothesis[] = [];
  const existingKeys = new Set(
    existingPlan.hypotheses.map((h) =>
      h.type === 'param'
        ? `${h.method}:${h.endpoint}:${h.param}:${h.technique}`
        : `form:${h.action}:${h.fields.join(',')}:${h.technique}`,
    ),
  );
  const targetOrigin = getOrigin(appModel.target);

  for (const ep of appModel.endpoints) {
    const url = joinUrl(targetOrigin, ep.path);
    if (isStaticAsset(url) || isThirdParty(url, targetOrigin)) continue;
    const method = ep.method || 'GET';
    const params = ep.params || [];

    let techniques: Technique[];
    try {
      const sel = await llmSelector.selectForEndpoint(ep, appModel);
      techniques = sel.techniques;
    } catch {
      techniques = getDefaultTechniques(appModel);
    }
    if (techniques.length === 0) continue;

    if (params.length === 0) {
      for (const technique of techniques) {
        const key = `${method}:${url}::${technique}`;
        if (!existingKeys.has(key)) {
          newHypotheses.push(createParamHypothesis(url, '', method, technique, source, 5));
        }
      }
    } else {
      for (const param of params) {
        const paramName = param.name;
        if (!paramName || paramName === 'undefined') continue;
        for (const technique of techniques) {
          const key = `${method}:${url}:${paramName}:${technique}`;
          if (!existingKeys.has(key)) {
            newHypotheses.push(createParamHypothesis(url, paramName, method, technique, source, 5));
          }
        }
      }
    }
  }

  for (const form of appModel.forms) {
    const action = form.action;
    if (isStaticAsset(action) || isThirdParty(action, targetOrigin)) continue;
    const fieldNames = form.fields.map((f) => f.name).filter(Boolean);
    if (fieldNames.length === 0) continue;

    let techniques: Technique[];
    try {
      const sel = await llmSelector.selectForForm(form, appModel);
      techniques = sel.techniques;
    } catch {
      techniques = getDefaultTechniques(appModel);
    }
    if (techniques.length === 0) continue;

    for (const technique of techniques) {
      const key = `form:${action}:${fieldNames.join(',')}:${technique}`;
      if (!existingKeys.has(key)) {
        newHypotheses.push(createFormHypothesis(action, fieldNames, technique, source, 5));
      }
    }
  }

  return newHypotheses;
}

function getTechniquesForParam(paramName: string, appModel: AppModel): Technique[] {
  const classifications = appModel.parameterClassifications || [];
  const pc = classifications.find(
    (c) => c.paramName?.toLowerCase() === paramName.toLowerCase(),
  );
  const classified = pc?.classifiedAs || '';

  switch (classified) {
    case 'id':
      return ['sqli', 'idor'];
    case 'email':
      return ['sqli', 'xss'];
    case 'password':
      return ['sqli'];
    case 'search':
      return ['xss', 'sqli', 'ssti'];
    case 'price':
    case 'quantity':
      return ['idor', 'sqli'];
    case 'file':
      return ['path', 'xxe'];
    case 'token':
      return [];
    default:
      return getDefaultTechniques(appModel);
  }
}

function getDeeperTechniques(technique: string): Technique[] {
  switch (technique) {
    case 'sqli':
      return ['sqli', 'sqli'];
    case 'xss':
      return ['xss', 'xss'];
    default:
      return [technique as Technique];
  }
}

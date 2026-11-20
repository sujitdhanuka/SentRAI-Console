import { M, SectionDef, sectionFields } from '../types';

export const DECISION_IMPACT = ['NONE', 'INFORMATIONAL', 'SUPPORTS_DECISIONS_ABOUT_PEOPLE', 'MAKES_DECISIONS_ABOUT_PEOPLE', 'SAFETY_CRITICAL'] as const;

const S = 'intended_use';

export const INTENDED_USE: SectionDef = {
  section_id: S,
  number: 2,
  title: 'Intended use and scope',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['business_justification', 'Business justification', 'longtext', 'Why the organisation uses this, in business terms.', { req: M, suggest: true }],
    ['purpose', 'Purpose', 'longtext', 'What it is for, in plain language. An AI draft counts only once a named person accepts or edits it.', { req: M, suggest: true, refs: ['nist-ai-rmf-1.0:MAP-1', 'iso-42001-2023:A.6'] }],
    ['intended_use', 'Intended use', 'longtext', 'The use it was designed and approved for.', { req: M, reassess: true, suggest: true }],
    ['permitted_use', 'Permitted use', 'longtext', 'Uses that are allowed, which may be narrower or wider than the intended use.', { req: M }],
    ['observed_use', 'Observed use', 'longtext', 'How it is actually used, from monitoring or usage records. UNKNOWN until observed.'],
    ['intended_users', 'Intended users', 'list', 'Who is meant to use it.', { req: M }],
    ['affected_segments', 'Affected segments', 'list', 'Groups of people or customers affected by its outputs.', { req: M, refs: ['nist-ai-rmf-1.0:MAP-5'] }],
    ['target_population', 'Target population', 'text', 'The population it is designed for, if any.'],
    ['tasks', 'Tasks', 'list', 'The tasks it performs.'],
    ['capabilities', 'Capabilities', 'list', 'What it can do, including generation, tool use or retrieval.', { req: M, reassess: true }],
    ['languages', 'Languages', 'list', 'Languages it supports or is used in.'],
    ['geographic_scope', 'Geographic scope', 'list', 'Countries or regions where it is used or where its outputs reach people.', { req: M, reassess: true }],
    ['operating_environment', 'Operating environment', 'text', 'Where and how it operates (internal tool, customer-facing app, batch job).'],
    ['expected_outputs', 'Expected outputs', 'text', 'What it produces.'],
    ['decision_impact', 'Decision impact', 'enum', 'How far its outputs affect decisions about people. Drives the fairness and risk rules.', { values: DECISION_IMPACT, req: M, reassess: true }],
    ['out_of_scope_uses', 'Out-of-scope uses', 'list', 'Uses it is not designed for.', { req: M }],
    ['prohibited_uses', 'Prohibited uses', 'list', 'Uses that are not allowed.', { req: M }],
    ['foreseeable_misuse', 'Foreseeable misuse', 'list', 'Ways it could reasonably be misused.', { refs: ['eu-ai-act-2024:ART-9'] }],
    ['known_limitations', 'Known limitations', 'list', 'Limitations users and reviewers should know.', { req: M }],
    ['expected_performance', 'Expected performance', 'text', 'The performance it is expected to reach, with the measure.'],
    ['usage_restrictions', 'Usage restrictions', 'list', 'Contractual, legal or policy restrictions on use.'],
  ]),
};

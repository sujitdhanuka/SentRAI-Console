import { SectionDef, sectionFields } from '../types';

const S = 'sustainability';

/**
 * Environmental sustainability. NOT_APPLICABLE with a justification is
 * allowed; for a third-party API whose provider discloses nothing, record
 * "provider does not disclose".
 */
export const SUSTAINABILITY: SectionDef = {
  section_id: S,
  number: 18,
  title: 'Environmental sustainability',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['training_energy', 'Training energy', 'text', 'Energy used to train it, or "provider does not disclose".', { rt: ['AI_MODEL'], refs: ['nist-ai-600-1:ENVIRONMENTAL'] }],
    ['inference_energy', 'Inference energy', 'text', 'Energy used to run it, from metering where available.', { register: 'energy' }],
    ['carbon', 'Carbon emissions', 'text', 'Emissions in kg CO2e, with the method.', { register: 'energy' }],
    ['water', 'Water use', 'text', 'Water used for cooling, where the data centre reports it.', { rule: 'R_SELF_HOSTED' }],
    ['hardware_utilisation', 'Hardware and GPU utilisation', 'text', 'How well the hardware is used.', { rule: 'R_SELF_HOSTED' }],
    ['sustainability_hosting_region', 'Hosting region', 'list', 'Region, which sets the grid carbon factor.'],
    ['efficiency_measures', 'Efficiency measures', 'longtext', 'Steps taken to reduce energy use.'],
    ['sustainability_assessment_date', 'Assessment date', 'date', 'When this section was last assessed.'],
  ]),
};

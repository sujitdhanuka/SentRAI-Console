import { MODEL_LIKE, SectionDef, sectionFields } from '../types';

const S = 'technical';

/** Technical specifications. UNKNOWN and NOT_APPLICABLE are allowed throughout; never guess. */
export const TECHNICAL: SectionDef = {
  section_id: S,
  number: 3,
  title: 'Technical specifications',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['architecture_description', 'Architecture description', 'longtext', 'How it is built, at the level a reviewer needs.', { rt: MODEL_LIKE, suggest: true }],
    ['parameter_count', 'Parameter count', 'text', 'Number of parameters, if disclosed. "Provider does not disclose" is a valid answer.', { rt: ['AI_MODEL'] }],
    ['input_modalities', 'Input modalities', 'list', 'Text, image, audio, tabular, and so on.', { rt: MODEL_LIKE }],
    ['output_modalities', 'Output modalities', 'list', 'What kinds of output it produces.', { rt: MODEL_LIKE }],
    ['context_window', 'Context window', 'text', 'Maximum input context, if relevant.', { rt: ['AI_MODEL', 'AGENT', 'RAG_PIPELINE'] }],
    ['token_limits', 'Token limits', 'text', 'Input and output token limits in use.', { rt: ['AI_MODEL', 'AGENT', 'RAG_PIPELINE', 'MODEL_CONFIGURATION'] }],
    ['formats', 'Formats', 'list', 'Input and output formats.'],
    ['inference_configuration', 'Inference configuration', 'longtext', 'Generation parameters (temperature, top-p, max tokens) and other inference settings.', { rule: 'R_GENERATIVE', reassess: true }],
    ['system_prompt', 'Prompts and system prompt', 'longtext', 'The system prompt and prompt templates in use, or where they are versioned. A change triggers reassessment.', { rule: 'R_GENERATIVE', reassess: true, sensitive: true, register: 'prompt_vault' }],
    ['fine_tuning', 'Fine-tuning', 'longtext', 'Whether and how the model was fine-tuned, on what data.', { rt: ['AI_MODEL', 'AI_SYSTEM'], reassess: true }],
    ['hardware', 'Hardware', 'text', 'Hardware it runs on, where you control it.', { rule: 'R_SELF_HOSTED' }],
    ['runtime', 'Runtime', 'text', 'Runtime or framework (for example the serving library and version).'],
    ['api_integration', 'API integration', 'longtext', 'How other systems call it, and which APIs it calls.', { reassess: true }],
    ['deployment_architecture', 'Hosting and deployment architecture', 'longtext', 'How it is hosted and deployed.'],
    ['serving_technology', 'Serving technology', 'text', 'The serving stack, if relevant.', { rt: MODEL_LIKE }],
  ]),
};

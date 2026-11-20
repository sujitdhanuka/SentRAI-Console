import { M, SectionDef, sectionFields, WITH_TRAINING } from '../types';

const S = 'data';

export const DATA_CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const;
const RAG = { rule: 'R_RAG' } as const;

/** Data governance and provenance, with the RAG fields (conditional on rule R_RAG). */
export const DATA: SectionDef = {
  section_id: S,
  number: 4,
  title: 'Data governance and provenance',
  applicability_rule_id: null,
  fields: sectionFields(S, [
    ['training_data_sources', 'Training data sources', 'list', 'Where the training data came from. For a third-party model, what the provider discloses.', { rt: WITH_TRAINING, reassess: true, refs: ['eu-ai-act-2024:ART-10', 'iso-42001-2023:A.7'] }],
    ['training_data_period', 'Training data period', 'text', 'The time span the training data covers.', { rt: WITH_TRAINING }],
    ['data_ownership', 'Data ownership', 'text', 'Who owns the data used.'],
    ['data_lineage', 'Data lineage', 'longtext', 'How data moves from source to the model or system.', { register: 'datasets' }],
    ['data_classification', 'Data classification', 'enum', 'The highest classification of data it handles.', { values: DATA_CLASSIFICATIONS, req: M }],
    ['data_quality', 'Data quality', 'longtext', 'How data quality is checked.', { rt: WITH_TRAINING }],
    ['representativeness', 'Representativeness', 'longtext', 'Whether the data represents the people and situations it will be used on.', { rt: WITH_TRAINING }],
    ['personal_data', 'Personal data processed', 'tristate', 'YES, NO or UNKNOWN. UNKNOWN is allowed in a draft but blocks FINAL. YES requires a data-flow entry.', { req: M, reassess: true, refs: ['gdpr:ART-6', 'in-dpdp-2023:NOTICE'] }],
    ['personal_data_categories', 'Personal-data categories', 'list', 'Which categories of personal data.', { rule: 'R_PERSONAL_DATA', sensitive: true }],
    ['data_flows', 'Personal-data flows', 'table', 'Where personal data comes from, where it goes and why.', {
      rule: 'R_PERSONAL_DATA', sensitive: true,
      columns: [
        { key: 'source', label: 'Source', data_type: 'text', required: true },
        { key: 'destination', label: 'Destination', data_type: 'text', required: true },
        { key: 'purpose', label: 'Purpose', data_type: 'text', required: true },
        { key: 'country', label: 'Destination country', data_type: 'text' },
      ],
    }],
    ['sensitive_categories', 'Sensitive categories', 'tristate', 'Whether special or sensitive categories of personal data are processed.', { rule: 'R_PERSONAL_DATA', sensitive: true, refs: ['gdpr:ART-9'] }],
    ['retention', 'Retention', 'text', 'How long data is kept, and where that rule is written down.', { rule: 'R_PERSONAL_DATA', refs: ['in-dpdp-2023:RETENTION'] }],
    ['residency', 'Data residency', 'list', 'Where data is stored.', { rule: 'R_PERSONAL_DATA' }],
    ['cross_border_transfers', 'Cross-border transfers', 'tristate', 'Whether personal data leaves the country it was collected in.', { rule: 'R_PERSONAL_DATA', refs: ['gdpr:ART-44', 'in-dpdp-2023:CROSS_BORDER'] }],
    ['transfer_destinations', 'Transfer destination countries', 'list', 'Countries personal data is transferred to.', { rule: 'R_PERSONAL_DATA' }],
    ['minimisation', 'Data minimisation', 'longtext', 'How the data used is limited to what is needed.', { rule: 'R_PERSONAL_DATA' }],
    ['lawful_basis', 'Lawful basis or consent', 'text', 'The legal basis for processing personal data.', { rule: 'R_PERSONAL_DATA', register: 'datasets', refs: ['gdpr:ART-6', 'in-dpdp-2023:CONSENT'] }],
    ['privacy_impact', 'Privacy impact assessment', 'url', 'Reference to the privacy impact assessment.', { rule: 'R_PERSONAL_DATA', ev: 'privacy_impact_assessment', refs: ['gdpr:ART-35'] }],
    ['copyright_ip', 'Copyright and IP', 'longtext', 'Copyright and IP position of training data and outputs.', { refs: ['nist-ai-600-1:INTELLECTUAL_PROPERTY'] }],
    ['poisoning_assessment', 'Data-poisoning assessment', 'longtext', 'How the risk of poisoned training or retrieval data is assessed.', { rt: ['AI_MODEL', 'AI_SYSTEM', 'RAG_PIPELINE'] }],
    ['synthetic_data', 'Synthetic data', 'tristate', 'Whether synthetic data is used.', { rt: WITH_TRAINING }],
    ['deletion_mechanism', 'Deletion mechanism', 'longtext', 'How data, including personal data, is deleted on request.', { rule: 'R_PERSONAL_DATA' }],
    ['provider_training_use', 'Provider may train on inputs', 'tristate', 'Whether the provider is allowed to train on what you send it. Check the contract or attestation.', { rule: 'R_THIRD_PARTY', ev: 'provider_terms', refs: ['nist-ai-600-1:DATA_PRIVACY'] }],
    ['rag_sources', 'Knowledge-base sources', 'list', 'Sources the pipeline retrieves from.', { ...RAG, reassess: true }],
    ['rag_ingestion', 'Ingestion', 'longtext', 'How documents enter the knowledge base.', RAG],
    ['rag_chunking', 'Chunking', 'text', 'How documents are split.', RAG],
    ['rag_embedding_model', 'Embedding model', 'records', 'The embedding model record used.', { ...RAG, reassess: true }],
    ['rag_vector_db', 'Vector database', 'text', 'The vector store and where it runs.', RAG],
    ['rag_retrieval_method', 'Retrieval method', 'text', 'How passages are selected (similarity, hybrid, re-ranking).', RAG],
    ['rag_retrieval_evaluation', 'Retrieval evaluation', 'url', 'Evidence of retrieval quality testing.', { ...RAG, ev: 'evaluation_report' }],
    ['rag_access_control', 'Access-control enforcement', 'longtext', 'How retrieval respects the user\'s permissions on source documents.', RAG],
    ['rag_refresh_frequency', 'Refresh frequency', 'text', 'How often the knowledge base is refreshed.', RAG],
    ['rag_injection_controls', 'Indirect prompt-injection controls', 'longtext', 'How instructions hidden in retrieved content are kept from steering the model.', { ...RAG, refs: ['nist-ai-600-1:INFORMATION_SECURITY'] }],
  ]),
};

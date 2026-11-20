/**
 * Golden regression fixture (spec §12): the v1 "Global Ai Model Settings"
 * record (738899cb-...) as it stood in the v1 inventory, verbatim. Used by
 * the migration, gate and PDF tests. Do not edit the texts: they are the
 * defects v2 must catch.
 */
import { V1Context } from './v1-mapper';

export const GOLDEN_V1_ID = '738899cb-70ea-4ee9-99fc-58c6ce44b67a';

export const GOLDEN_V1_PURPOSE = [
  'Here is a concise, plain-language summary of the "Global Ai Model Settings" software component:',
  '**What it does:** This component manages the default AI model settings for a platform, which applies to every organization unless they have their own "Bring Your Own Key" (BYOK) toggle enabled.',
  '**Decisions/outputs:** It fetches the current AI model settings from an API endpoint, and allows authorized users to save changes to these settings. The component also displays a message indicating whether the settings were saved successfully.',
  '**Who/what it affects:** This component affects the AI model used by every organization on the platform, unless they have their own BYOK toggle enabled. It influences the AI model used for various tasks, such as processing requests.',
  '**Personal data processing:** This component processes personal data, as it interacts with an API endpoint that likely handles sensitive information related to the AI model settings.',
  'Note: This summary is based on the provided code excerpt and may not be comprehensive or up-to-date, as the code may have been modified or extended since the excerpt was taken.',
].join('\n\n');

export const GOLDEN_V1_RATIONALE = [
  'Here is a rationale for why the AI model is classified LOW risk:',
  'The Global Ai Model Settings component is classified as LOW risk due to its limited autonomous scope and the requirement for human oversight. The component does not declare any autonomous scope, meaning it does not operate independently without human intervention. Additionally, human-in-the-loop review is required before outputs are acted on, which mitigates the risk of unintended consequences. While the component does process personal data, this is a necessary function for managing AI model settings, and the risk is not elevated due to the component\'s design and the required human oversight.',
].join('\n\n');

export const GOLDEN_ORG = 'org-golden';

/** The v1 context. "Admin Dhancept" is marked as a service account here, per decision 5. */
export function goldenV1Context(ownerAccountType: 'HUMAN' | 'SERVICE' = 'SERVICE'): V1Context {
  return {
    orgId: GOLDEN_ORG,
    record: {
      id: GOLDEN_V1_ID, name: 'Global Ai Model Settings', modelType: 'GENERATIVE_AI', functionalArea: 'unclassified',
      useCaseDescription: GOLDEN_V1_PURPOSE, descriptionSource: 'ai', targetCustomerSegments: [],
      riskLevel: 'LOW', riskRationale: GOLDEN_V1_RATIONALE, riskRationaleSource: 'ai',
      lifecycleStage: 'DESIGN', operationalState: 'ACTIVE', deploymentDate: null,
      ownerTeam: 'Admin Dhancept', ownerUserId: 'user-admin-dhancept', developedBy: null,
      humanOversightRequired: true, autonomousScope: null, dependencies: [],
      sourceRefs: ['Dhancept/src/app/components/GlobalAiModelSettings.tsx'], detectionSignals: [], detectedTools: [],
      boardPolicyRef: null, lastRedTeamDate: null, nextAuditDue: null, grievanceCount: 0, energyKwh: null, registeredAt: '2026-11-01T00:00:00.000Z',
    },
    owner: {
      id: 'user-admin-dhancept', fullName: 'Admin Dhancept', email: 'admin.dhancept@example.test', isActive: true,
      tenantId: GOLDEN_ORG, role: 'CISO', accountType: ownerAccountType,
    },
    datasetPersonalData: false,
    verdicts: [
      { framework: 'ISO/IEC 42001', pass: true, gaps: 0 },
      { framework: 'NIST AI RMF', pass: false, gaps: 3 },
    ],
  };
}

/** Static payload for GET /api/v1/sutras — mirrors main.py::list_sutras. */
export const SUTRAS = {
  framework: 'SentrAI',
  issued_by: 'Reserve Bank of India',
  date: 'August 2025',
  sutras: [
    { id: 1, name: 'Trust is the Foundation', principle: 'Trust is non-negotiable and should remain uncompromised' },
    { id: 2, name: 'People First', principle: 'AI should augment human decision-making but defer to human judgment' },
    { id: 3, name: 'Innovation over Restraint', principle: 'Foster responsible innovation with purpose' },
    { id: 4, name: 'Fairness and Equity', principle: 'AI outcomes should be fair and non-discriminatory' },
    { id: 5, name: 'Accountability', principle: 'Accountability rests with the entities deploying AI' },
    { id: 6, name: 'Understandable by Design', principle: 'Ensure explainability for trust' },
    { id: 7, name: 'Safety, Resilience, and Sustainability', principle: 'AI systems should be secure, resilient and energy efficient' },
  ],
  pillars: ['Infrastructure', 'Policy', 'Capacity', 'Governance', 'Protection', 'Assurance'],
  total_recommendations: 26,
};

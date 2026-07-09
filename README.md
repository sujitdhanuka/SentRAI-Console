# SentrAI Compliance Console

SentrAI Compliance Console is a comprehensive AI governance platform designed to operationalize the RBI's **SentrAI Framework** (*Framework for Responsible and Ethical Enablement of AI*). It bridges the gap between policy and practice by providing actionable tools to discover, track, govern, and monitor AI models across your organization's projects.

## Core Capabilities

SentrAI implements the **Governance**, **Protection**, and **Assurance** pillars of the SentrAI framework end-to-end:

* **Discovery & Scanning**: Automatically scan source code to identify AI models, LLM API calls, Machine Learning logic, and FinTech algorithmic patterns.
* **Model Inventory**: Maintain a centralized registry of all AI models, tracking their lifecycle stages (Design to Decommissioned) and compliance posture.
* **Governance Enforcement**: Close compliance gaps by declaring model owners, linking board policy references, and ensuring oversight aligns with the 7 Sutras of Responsible AI.
* **Drift Monitoring**: Evaluate live model performance against training baselines (e.g., PSI, Wasserstein distance) to detect drift and trigger automated circuit breakers.
* **Auditing**: Perform rigorous audits covering data inputs (bias, consent), model logic, and outputs.
* **Incident Management**: Track and remediate AI-related incidents (e.g., bias, data leakage, drift) based on severity-driven SLAs.

## Workflow

1. **Create Project**: Point to an application's codebase directory.
2. **Discover Models**: Perform static analysis to find AI components.
3. **Triage**: Review identified candidates and register genuine models.
4. **Close Governance Gaps**: Apply governance metadata and ensure compliance.
5. **Formal Audit**: Run periodic structural and behavioral checks.
6. **Deploy & Monitor**: Track drift metrics and establish BCP fallbacks.
7. **Incident Response**: Address any anomalies or policy breaches in real-time.

## Getting Started

### Prerequisites

* Python 3.11+
* PostgreSQL (or SQLite for local development)

### Setup & Run

1. **Install Dependencies** (It is recommended to use a virtual environment):
   ```bash
   pip install -e .
   ```
2. **Environment Setup**:
   Configure your database connection and other variables in `.env`. (You can copy `.env.example` as a starting point).
3. **Run the Server**:
   ```bash
   uvicorn sentrai.main:app --app-dir src --reload --reload-dir src --port 8000
   ```
4. **Access the App**:
   Navigate to `http://localhost:8000` to access the SentrAI dashboard. The API documentation is available at `http://localhost:8000/docs`.

## Future Roadmap

* Automated Red-Teaming & Security Scanning
* Real-Time Drift Webhooks & Alerting
* Automated Evidence Collection for Audits
* Active Bias Mitigation Tools
* One-Click Regulatory Filings (e.g., RBI Annexures, EU AI Act)

---
*For a detailed overview of the framework and operational guidelines, see the [Help Documentation](docs/HELP.md).*

# For Demo visit [Dhancept](http://www.dhancept.com)

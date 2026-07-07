from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "RBI SentrAI Compliance Service"
    debug: bool = False

    database_url: str = "postgresql+asyncpg://sentrai:sentrai@localhost:5432/sentrai_compliance"
    database_url_sync: str = "postgresql+psycopg2://sentrai:sentrai@localhost:5432/sentrai_compliance"

    redis_url: str = "redis://localhost:6379/0"

    # Neo4j Graph DB Config
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "password"

    # JWT
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # DPDP Act — fields that must be masked in audit logs and API responses
    dpdp_pii_fields: list[str] = [
        "pan", "aadhaar", "mobile", "email", "account_number",
        "customer_id", "ip_address", "device_id",
    ]

    # Drift monitoring
    psi_warning_threshold: float = 0.10
    psi_alert_threshold: float = 0.20
    accuracy_drop_alert_pct: float = 0.05

    # Inventory semi-annual update enforcement (days)
    inventory_update_sla_days: int = 180


settings = Settings()

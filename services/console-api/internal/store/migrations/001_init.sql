-- console-api own state. EdgeAPI remains the source of truth for users, sites,
-- certificates and nodes; these tables only hold what EdgeAPI has no place for.

CREATE TABLE IF NOT EXISTS sessions (
  id_hash      CHAR(64)     NOT NULL COMMENT 'hex SHA-256 of the cookie value',
  kind         VARCHAR(8)   NOT NULL COMMENT 'user | admin',
  subject_id   BIGINT       NOT NULL,
  username     VARCHAR(255) NOT NULL DEFAULT '',
  ip           VARCHAR(64)  NOT NULL DEFAULT '',
  user_agent   VARCHAR(255) NOT NULL DEFAULT '',
  created_at   BIGINT       NOT NULL,
  last_seen_at BIGINT       NOT NULL,
  expires_at   BIGINT       NOT NULL COMMENT 'absolute expiry',
  PRIMARY KEY (id_hash),
  KEY idx_subject (kind, subject_id),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS login_failures (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  scope      VARCHAR(8)   NOT NULL COMMENT 'user | admin',
  key_type   VARCHAR(8)   NOT NULL COMMENT 'name | ip',
  key_value  VARCHAR(255) NOT NULL,
  created_at BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_key (scope, key_type, key_value, created_at),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash CHAR(64)     NOT NULL,
  purpose    VARCHAR(16)  NOT NULL COMMENT 'verify | reset',
  user_id    BIGINT       NOT NULL,
  email      VARCHAR(255) NOT NULL,
  created_at BIGINT       NOT NULL,
  expires_at BIGINT       NOT NULL,
  used_at    BIGINT       NULL,
  PRIMARY KEY (token_hash),
  KEY idx_user (user_id, purpose),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_flags (
  user_id           BIGINT NOT NULL,
  email_verified_at BIGINT NULL,
  pending_email     TINYINT NOT NULL DEFAULT 0 COMMENT '1 = must verify before login',
  last_login_at     BIGINT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  actor_type VARCHAR(8)   NOT NULL COMMENT 'user | admin | system',
  actor_id   BIGINT       NOT NULL DEFAULT 0,
  actor_name VARCHAR(255) NOT NULL DEFAULT '',
  action     VARCHAR(512) NOT NULL,
  ip         VARCHAR(64)  NOT NULL DEFAULT '',
  level      VARCHAR(8)   NOT NULL DEFAULT 'info',
  created_at BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_actor (actor_type, actor_id, id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  name       VARCHAR(64) NOT NULL,
  value      MEDIUMTEXT  NOT NULL,
  updated_at BIGINT      NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS site_meta (
  server_id      BIGINT      NOT NULL,
  user_id        BIGINT      NOT NULL,
  auto_cert      TINYINT     NOT NULL DEFAULT 0,
  dns_checked_at BIGINT      NULL,
  dns_ok         TINYINT     NOT NULL DEFAULT 0,
  dns_checks     MEDIUMTEXT  NULL,
  PRIMARY KEY (server_id),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS acme_jobs (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  user_id      BIGINT      NOT NULL,
  server_id    BIGINT      NOT NULL DEFAULT 0,
  edge_task_id BIGINT      NOT NULL DEFAULT 0,
  domains      TEXT        NOT NULL,
  status       VARCHAR(16) NOT NULL COMMENT 'pending | running | success | failed',
  cert_id      BIGINT      NOT NULL DEFAULT 0,
  error        VARCHAR(1024) NULL,
  created_at   BIGINT      NOT NULL,
  updated_at   BIGINT      NOT NULL,
  PRIMARY KEY (id),
  KEY idx_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

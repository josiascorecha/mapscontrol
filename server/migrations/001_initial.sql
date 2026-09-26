-- MapsControl — esquema inicial
-- Convenções: ids UUID, datas em timestamptz (UTC), datas de visita em date (calendário local).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Usuários e autenticação
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email             text UNIQUE,            -- NULL após exclusão (anonimização)
  password_hash     text,                   -- NULL até definir senha (conta ativada por link)
  email_verified_at timestamptz,
  -- Intenção declarada no cadastro. NÃO concede privilégio algum: só decide
  -- qual fluxo a interface mostra (criar congregação x informar código).
  signup_intent     text NOT NULL DEFAULT 'publisher' CHECK (signup_intent IN ('publisher','admin')),
  -- Administrador Geral: só pode ser definido pelo script de servidor
  -- (npm run bootstrap:global-admin). Nenhuma rota da API altera este campo.
  is_global_admin   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CHECK (email IS NULL OR email = lower(email))
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,        -- SHA-256 do token do cookie
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- Tokens de e-mail: confirmação, recuperação de senha e ativação de conta.
CREATE TABLE email_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email','reset_password','activate')),
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_idx ON email_tokens(user_id, purpose);

-- Aceite de termos de uso e política de privacidade (versão + data).
CREATE TABLE consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document    text NOT NULL CHECK (document IN ('terms','privacy')),
  version     text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_idx ON consents(user_id);

-- Limitação de tentativas (persistente, vale após reinício do serviço).
CREATE TABLE rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- ---------------------------------------------------------------------------
-- Congregações e membros
-- ---------------------------------------------------------------------------
CREATE TABLE congregations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  city       text CHECK (length(city) <= 80),
  state      text CHECK (length(state) <= 2),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  congregation_id uuid NOT NULL REFERENCES congregations(id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('publisher','admin')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  joined_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES users(id),
  UNIQUE (user_id, congregation_id)
);
-- Cada usuário participa de no máximo uma congregação ativa.
CREATE UNIQUE INDEX memberships_one_active_per_user ON memberships(user_id) WHERE status = 'active';
CREATE INDEX memberships_cong_idx ON memberships(congregation_id);

-- Códigos de acesso para publicadores (individuais, uso único, com validade).
CREATE TABLE access_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id uuid NOT NULL REFERENCES congregations(id) ON DELETE CASCADE,
  code_hash       bytea NOT NULL UNIQUE,     -- HMAC-SHA256(código, CODE_PEPPER)
  code_hint       text NOT NULL,             -- últimos 4 caracteres, para identificação visual
  label           text CHECK (length(label) <= 60),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  used_by         uuid REFERENCES users(id),
  canceled_at     timestamptz,
  canceled_by     uuid REFERENCES users(id)
);
CREATE INDEX access_codes_cong_idx ON access_codes(congregation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Territórios, quadras, endereços e apartamentos
-- ---------------------------------------------------------------------------
CREATE TABLE territories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id uuid NOT NULL REFERENCES congregations(id) ON DELETE CASCADE,
  number          integer NOT NULL CHECK (number > 0),
  name            text CHECK (length(name) <= 120),
  notes           text CHECK (length(notes) <= 1000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (congregation_id, number),
  UNIQUE (id, congregation_id)
);

CREATE TABLE blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id uuid NOT NULL,
  territory_id    uuid NOT NULL,
  number          integer NOT NULL CHECK (number > 0),
  name            text CHECK (length(name) <= 120),
  maps_url        text CHECK (length(maps_url) <= 2000),
  lat             double precision CHECK (lat BETWEEN -90 AND 90),
  lng             double precision CHECK (lng BETWEEN -180 AND 180),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (territory_id, number),
  UNIQUE (id, congregation_id),
  CHECK ((lat IS NULL) = (lng IS NULL)),
  -- A congregação da quadra é obrigatoriamente a mesma do território.
  FOREIGN KEY (territory_id, congregation_id) REFERENCES territories(id, congregation_id) ON DELETE CASCADE
);

CREATE TABLE addresses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id uuid NOT NULL,
  block_id        uuid NOT NULL,
  kind            text NOT NULL DEFAULT 'house' CHECK (kind IN ('house','building')),
  number          text NOT NULL CHECK (length(number) BETWEEN 1 AND 20),
  street          text CHECK (length(street) <= 120),
  name            text CHECK (length(name) <= 120),   -- nome do prédio (opcional)
  notes           text CHECK (length(notes) <= 500),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, congregation_id),
  FOREIGN KEY (block_id, congregation_id) REFERENCES blocks(id, congregation_id) ON DELETE CASCADE
);
CREATE INDEX addresses_block_idx ON addresses(block_id);

CREATE TABLE units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id uuid NOT NULL,
  address_id      uuid NOT NULL,
  tower           text NOT NULL DEFAULT '' CHECK (length(tower) <= 30),   -- bloco/torre
  identifier      text NOT NULL CHECK (length(identifier) BETWEEN 1 AND 20), -- nº do apto
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (address_id, tower, identifier),
  UNIQUE (id, congregation_id),
  FOREIGN KEY (address_id, congregation_id) REFERENCES addresses(id, congregation_id) ON DELETE CASCADE
);

-- Histórico: cada linha é um registro imutável (pode ser anulado, nunca sobrescrito).
CREATE TABLE visit_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  congregation_id uuid NOT NULL,
  address_id      uuid NOT NULL,
  unit_id         uuid,                  -- obrigatório quando o endereço é prédio
  action          text NOT NULL CHECK (action IN ('contact','letter','absent')),
  occurred_on     date NOT NULL,
  note            text CHECK (length(note) <= 300),
  author_id       uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  voided_by       uuid REFERENCES users(id),
  void_reason     text CHECK (length(void_reason) <= 200),
  FOREIGN KEY (address_id, congregation_id) REFERENCES addresses(id, congregation_id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id, congregation_id) REFERENCES units(id, congregation_id) ON DELETE CASCADE
);
CREATE INDEX visit_records_address_idx ON visit_records(address_id, unit_id);
CREATE INDEX visit_records_cong_idx ON visit_records(congregation_id);

-- Garante que registro de casa não tenha apartamento e registro de prédio tenha
-- apartamento do mesmo prédio.
CREATE FUNCTION visit_records_check_target() RETURNS trigger AS $$
DECLARE
  k text;
  unit_addr uuid;
BEGIN
  SELECT kind INTO k FROM addresses WHERE id = NEW.address_id;
  IF k = 'house' AND NEW.unit_id IS NOT NULL THEN
    RAISE EXCEPTION 'registro de casa não pode ter apartamento' USING ERRCODE = '23514';
  END IF;
  IF k = 'building' THEN
    IF NEW.unit_id IS NULL THEN
      RAISE EXCEPTION 'registro de prédio exige apartamento' USING ERRCODE = '23514';
    END IF;
    SELECT address_id INTO unit_addr FROM units WHERE id = NEW.unit_id;
    IF unit_addr IS DISTINCT FROM NEW.address_id THEN
      RAISE EXCEPTION 'apartamento não pertence ao prédio' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER visit_records_check_target_trg
  BEFORE INSERT ON visit_records
  FOR EACH ROW EXECUTE FUNCTION visit_records_check_target();

-- Situação derivada de cada casa/apartamento a partir do histórico não anulado.
--   contacted : existe ao menos um contato realizado (data = último contato)
--   letter    : sem contato, mas com carta (data = última carta)
--   pending   : nenhum contato e nenhuma carta
-- Registros posteriores de ausência/carta nunca apagam um contato anterior.
CREATE VIEW target_status AS
SELECT
  t.congregation_id,
  t.address_id,
  t.unit_id,
  max(v.occurred_on) FILTER (WHERE v.action = 'contact') AS last_contact_on,
  max(v.occurred_on) FILTER (WHERE v.action = 'letter')  AS last_letter_on,
  max(v.occurred_on) FILTER (WHERE v.action = 'absent')  AS last_absent_on,
  count(v.id) AS record_count,
  CASE
    WHEN bool_or(v.action = 'contact') THEN 'contacted'
    WHEN bool_or(v.action = 'letter')  THEN 'letter'
    ELSE 'pending'
  END AS status
FROM (
  SELECT a.congregation_id, a.id AS address_id, NULL::uuid AS unit_id
    FROM addresses a WHERE a.kind = 'house'
  UNION ALL
  SELECT u.congregation_id, u.address_id, u.id AS unit_id
    FROM units u
) t
LEFT JOIN visit_records v
  ON v.address_id = t.address_id
 AND v.unit_id IS NOT DISTINCT FROM t.unit_id
 AND v.voided_at IS NULL
GROUP BY t.congregation_id, t.address_id, t.unit_id;

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid REFERENCES users(id),
  actor_global    boolean NOT NULL DEFAULT false,  -- ação feita como Administrador Geral
  congregation_id uuid REFERENCES congregations(id) ON DELETE SET NULL,
  action          text NOT NULL,
  entity          text,
  entity_id       text,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_cong_idx ON audit_log(congregation_id, at DESC);
CREATE INDEX audit_log_at_idx ON audit_log(at);
